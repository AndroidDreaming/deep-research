import { streamText } from "ai";
import { Md5 } from "ts-md5";
import { toast } from "sonner";
import useModelProvider from "@/hooks/useAiProvider";
import { useKnowledgeStore } from "@/store/knowledge";
import { useTaskStore } from "@/store/task";
import { useSettingStore } from "@/store/setting";
import { rewritingPrompt } from "@/constants/prompts";
import { fileParser } from "@/utils/parser";
import { generateSignature } from "@/utils/signature";
import { getTextByteSize } from "@/utils/file";
import { parseError } from "@/utils/error";
import { omit } from "radash";

interface CrawlerResult {
  url: string;
  title: string;
  content: string;
}

interface ReaderResult extends CrawlerResult {
  warning?: string;
  title: string;
  description: string;
  url: string;
  content: string;
  usage: {
    tokens: number;
  };
}

function handleError(error: unknown) {
  const errorMessage = parseError(error);
  toast.error(errorMessage);
}

async function jinaReader(url: string) {
  const response = await fetch("https://r.jina.ai", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ url }),
  });

  const { data }: { data: ReaderResult } = await response.json();
  if (data.warning) {
    throw new Error(data.warning);
  }
  return omit(data, ["usage", "description"]) as CrawlerResult;
}

async function localCrawler(url: string) {
  const { accessPassword } = useSettingStore.getState();
  const accessKey = generateSignature(accessPassword, Date.now());
  const response = await fetch("/api/crawler", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessKey}`,
    },
    body: JSON.stringify({ url }),
  });
  const result: CrawlerResult = await response.json();
  return result;
}

function useKnowledge() {
  const { createProvider, getModel } = useModelProvider();
  const knowledgeStore = useKnowledgeStore();

  function generateId(
    type: "file" | "url" | "knowledge",
    options?: {
      fileMeta?: FileMeta;
      url?: string;
    }
  ): string {
    if (type === "file" && options && options.fileMeta) {
      const { fileMeta } = options;
      const meta = `${fileMeta.name}::${fileMeta.size}::${fileMeta.type}::${fileMeta.lastModified}`;
      return Md5.hashStr(meta);
    } else if (type === "url" && options && options.url) {
      return Md5.hashStr(
        `${options.url}::${Date.now().toString().substring(0, 8)}`
      );
    } else if (type === "knowledge") {
      return Md5.hashStr(`KNOWLEDGE::${Date.now()}`);
    } else {
      throw new Error("Parameter error");
    }
  }

  async function getKnowledgeFromFile(file: File) {
    const { resources, addResource, updateResource } = useTaskStore.getState();

    const fileMeta: FileMeta = {
      name: file.name,
      size: file.size,
      type: file.type,
      lastModified: file.lastModified,
    };
    const id = generateId("file", { fileMeta });
    const isExist = resources.find((item) => item.id === id);
    if (isExist) {
      return toast.message(`File already exist: ${file.name}`);
    }
    try {
      if (knowledgeStore.exist(id)) {
        const knowledge = knowledgeStore.get(id);
        if (knowledge) {
          addResource({
            id,
            name: knowledge.title,
            type: knowledge.type,
            size: getTextByteSize(knowledge.content),
            status: "completed",
          });
        }
      } else {
        addResource({
          ...omit(fileMeta, ["lastModified"]),
          id,
          status: "processing",
        });
        const { networkingModel } = getModel();
        const text = await fileParser(file);
        if (text.length > 204800 || !file.type.startsWith("text/")) {
          let content = "";
          const result = streamText({
            model: createProvider(networkingModel),
            prompt: text,
            system: rewritingPrompt,
            onFinish: () => {
              const currentTime = Date.now();
              knowledgeStore.save({
                id,
                title: fileMeta.name,
                content,
                type: "file",
                fileMeta,
                createdAt: currentTime,
                updatedAt: currentTime,
              });
            },
            onError: (err) => {
              updateResource(id, { status: "failed" });
              handleError(err);
            },
          });
          for await (const textPart of result.textStream) {
            content += textPart;
          }
          updateResource(id, {
            size: getTextByteSize(content),
            status: "completed",
          });
        } else {
          knowledgeStore.save({
            id,
            title: fileMeta.name,
            content: text,
            type: "file",
            fileMeta,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          });
          updateResource(id, {
            size: getTextByteSize(text),
            status: "completed",
          });
        }
      }
    } catch (err) {
      if (err instanceof Error) {
        updateResource(id, { status: "failed" });
        toast.error(err.message);
      } else {
        toast.error("File parsing failed");
      }
    }
  }

  async function getKnowledgeFromUrl(url: string, crawler: string) {
    const knowledgeStore = useKnowledgeStore.getState();
    const { resources, addResource, updateResource } = useTaskStore.getState();

    const id = generateId("url", { url });
    const isExist = resources.find((item) => item.id === id);
    if (isExist) {
      return toast.message(`Url already loaded: ${url}`);
    }
    try {
      if (knowledgeStore.exist(id)) {
        const knowledge = knowledgeStore.get(id);
        if (knowledge) {
          addResource({
            id,
            name: url,
            type: "url",
            size: getTextByteSize(knowledge.content),
            status: "completed",
          });
        }
      } else {
        addResource({
          id,
          name: url,
          type: "url",
          size: 0,
          status: "processing",
        });
        if (crawler === "jina") {
          const result = await jinaReader(url);
          const currentTime = Date.now();
          knowledgeStore.save({
            id,
            title: result.title,
            content: result.content,
            type: "url",
            url,
            createdAt: currentTime,
            updatedAt: currentTime,
          });
          updateResource(id, {
            size: getTextByteSize(result.content),
            status: "completed",
          });
        } else if (crawler === "local") {
          const { networkingModel } = getModel();
          const result = await localCrawler(url);
          let content = "";
          const stream = streamText({
            model: createProvider(networkingModel),
            prompt: result.content,
            system: rewritingPrompt,
            onFinish: () => {
              const currentTime = Date.now();
              knowledgeStore.save({
                id,
                title: result.title,
                content,
                type: "url",
                url,
                createdAt: currentTime,
                updatedAt: currentTime,
              });
            },
            onError: (err) => {
              updateResource(id, { status: "failed" });
              handleError(err);
            },
          });
          for await (const textPart of stream.textStream) {
            content += textPart;
          }
          updateResource(id, {
            size: getTextByteSize(content),
            status: "completed",
          });
        } else {
          throw new Error(`Unknown crawler: ${crawler}`);
        }
      }
    } catch (err) {
      if (err instanceof Error) {
        updateResource(id, { status: "failed" });
        return toast.error(err.message);
      } else {
        toast.error("Url parsing failed");
      }
    }
  }

  return {
    generateId,
    getKnowledgeFromFile,
    getKnowledgeFromUrl,
  };
}

export default useKnowledge;
