import { useState } from "react";
import { streamText, smoothStream } from "ai";
import { parsePartialJson } from "@ai-sdk/ui-utils";
import { openai } from "@ai-sdk/openai";
import { type GoogleGenerativeAIProviderMetadata } from "@ai-sdk/google";
import { useTranslation } from "react-i18next";
import Plimit from "p-limit";
import { toast } from "sonner";
import useModelProvider from "@/hooks/useAiProvider";
import useWebSearch from "@/hooks/useWebSearch";
import { useTaskStore } from "@/store/task";
import { useHistoryStore } from "@/store/history";
import { useSettingStore } from "@/store/setting";
import { useKnowledgeStore } from "@/store/knowledge";
import { outputGuidelinesPrompt } from "@/constants/prompts";
import {
  getSystemPrompt,
  generateQuestionsPrompt,
  writeReportPlanPrompt,
  generateSerpQueriesPrompt,
  processResultPrompt,
  processSearchResultPrompt,
  processSearchKnowledgeResultPrompt,
  reviewSerpQueriesPrompt,
  writeFinalReportPrompt,
  getSERPQuerySchema,
} from "@/utils/deep-research";
import { isNetworkingModel } from "@/utils/model";
import { parseError } from "@/utils/error";
import { pick, flat, unique } from "radash";

function getResponseLanguagePrompt(lang: string) {
  return `**Respond in ${lang}**`;
}

function removeJsonMarkdown(text: string) {
  text = text.trim();
  if (text.startsWith("```json")) {
    text = text.slice(7);
  } else if (text.startsWith("json")) {
    text = text.slice(4);
  } else if (text.startsWith("```")) {
    text = text.slice(3);
  }
  if (text.endsWith("```")) {
    text = text.slice(0, -3);
  }
  return text.trim();
}

function smoothTextStream() {
  return smoothStream({
    chunking: "word",
    delayInMs: 0,
  });
}

function handleError(error: unknown) {
  const errorMessage = parseError(error);
  toast.error(errorMessage);
}

function useDeepResearch() {
  const { t } = useTranslation();
  const taskStore = useTaskStore();
  const { createProvider, getModel } = useModelProvider();
  const { tavily, firecrawl, exa, bocha, searxng } = useWebSearch();
  const [status, setStatus] = useState<string>("");

  async function askQuestions() {
    const { language } = useSettingStore.getState();
    const { question } = useTaskStore.getState();
    const { thinkingModel } = getModel();
    setStatus(t("research.common.thinking"));
    const result = streamText({
      model: createProvider(thinkingModel),
      system: getSystemPrompt(),
      prompt: [
        generateQuestionsPrompt(question),
        getResponseLanguagePrompt(language),
      ].join("\n\n"),
      experimental_transform: smoothTextStream(),
      onError: handleError,
    });
    let content = "";
    taskStore.setQuestion(question);
    for await (const textPart of result.textStream) {
      content += textPart;
      taskStore.updateQuestions(content);
    }
  }

  async function writeReportPlan() {
    const { language } = useSettingStore.getState();
    const { query } = useTaskStore.getState();
    const { thinkingModel } = getModel();
    setStatus(t("research.common.thinking"));
    const result = streamText({
      model: createProvider(thinkingModel),
      system: getSystemPrompt(),
      prompt: [
        writeReportPlanPrompt(query),
        getResponseLanguagePrompt(language),
      ].join("\n\n"),
      experimental_transform: smoothTextStream(),
      onError: handleError,
    });
    let content = "";
    for await (const textPart of result.textStream) {
      content += textPart;
      taskStore.updateReportPlan(content);
    }
    return content;
  }

  async function searchLocalKnowledges(query: string, researchGoal: string) {
    const { resources } = useTaskStore.getState();
    const knowledgeStore = useKnowledgeStore.getState();
    const { language } = useSettingStore.getState();
    const knowledges: Knowledge[] = [];

    for (const item of resources) {
      if (item.status === "completed") {
        const resource = knowledgeStore.get(item.id);
        if (resource) {
          knowledges.push(resource);
        }
      }
    }

    const { networkingModel } = getModel();
    const searchResult = streamText({
      model: createProvider(networkingModel),
      system: getSystemPrompt(),
      prompt: [
        processSearchKnowledgeResultPrompt(query, researchGoal, knowledges),
        getResponseLanguagePrompt(language),
      ].join("\n\n"),
      experimental_transform: smoothTextStream(),
      onError: handleError,
    });
    let content = "";
    for await (const textPart of searchResult.textStream) {
      content += textPart;
      taskStore.updateTask(query, { learning: content });
    }
    return content;
  }

  async function runSearchTask(queries: SearchTask[]) {
    const {
      provider,
      enableSearch,
      searchProvider,
      parallelSearch,
      searchMaxResult,
      language,
    } = useSettingStore.getState();
    const { resources } = useTaskStore.getState();
    const { networkingModel } = getModel();
    setStatus(t("research.common.research"));
    const plimit = Plimit(parallelSearch);
    const createModel = (model: string) => {
      // Enable Gemini's built-in search tool
      if (
        enableSearch &&
        searchProvider === "model" &&
        provider === "google" &&
        isNetworkingModel(model)
      ) {
        return createProvider(model, { useSearchGrounding: true });
      } else {
        return createProvider(model);
      }
    };
    const getTools = (model: string) => {
      // Enable OpenAI's built-in search tool
      if (
        enableSearch &&
        searchProvider === "model" &&
        provider === "openai" &&
        model.startsWith("gpt-4o")
      ) {
        return {
          web_search_preview: openai.tools.webSearchPreview({
            // optional configuration:
            searchContextSize: "medium",
          }),
        };
      } else {
        return undefined;
      }
    };
    const getProviderOptions = () => {
      // Enable OpenRouter's built-in search tool
      if (
        enableSearch &&
        searchProvider === "model" &&
        provider === "openrouter"
      ) {
        return {
          openrouter: {
            plugins: [
              {
                id: "web",
                max_results: searchMaxResult, // Defaults to 5
              },
            ],
          },
        };
      } else {
        return undefined;
      }
    };
    await Promise.all(
      queries.map((item) => {
        plimit(async () => {
          let content = "";
          let searchResult;
          let sources: Source[] = [];
          taskStore.updateTask(item.query, { state: "processing" });
          if (resources.length > 0) {
            const knowledges = await searchLocalKnowledges(
              item.query,
              item.researchGoal
            );
            content += [
              knowledges,
              `### ${t("research.searchResult.references")}`,
              resources.map((item) => `- ${item.name}`).join("\n"),
              "---",
              "",
            ].join("\n\n");
          }
          if (enableSearch) {
            if (searchProvider !== "model") {
              try {
                if (searchProvider === "tavily") {
                  sources = await tavily(item.query);
                } else if (searchProvider === "firecrawl") {
                  sources = await firecrawl(item.query);
                } else if (searchProvider === "exa") {
                  sources = await exa(item.query);
                } else if (searchProvider === "bocha") {
                  sources = await bocha(item.query);
                } else if (searchProvider === "searxng") {
                  sources = await searxng(item.query);
                }
              } catch (err) {
                console.error(err);
                handleError(`[${searchProvider}]: Search failed`);
                return plimit.clearQueue();
              }
              searchResult = streamText({
                model: createModel(networkingModel),
                system: getSystemPrompt(),
                prompt: [
                  processSearchResultPrompt(
                    item.query,
                    item.researchGoal,
                    sources
                  ),
                  getResponseLanguagePrompt(language),
                ].join("\n\n"),
                experimental_transform: smoothTextStream(),
                onError: handleError,
              });
            } else {
              searchResult = streamText({
                model: createModel(networkingModel),
                system: getSystemPrompt(),
                prompt: [
                  processResultPrompt(item.query, item.researchGoal),
                  getResponseLanguagePrompt(language),
                ].join("\n\n"),
                tools: getTools(networkingModel),
                providerOptions: getProviderOptions(),
                experimental_transform: smoothStream(),
                onError: handleError,
              });
            }
          } else {
            searchResult = streamText({
              model: createProvider(networkingModel),
              system: getSystemPrompt(),
              prompt: [
                processResultPrompt(item.query, item.researchGoal),
                getResponseLanguagePrompt(language),
              ].join("\n\n"),
              experimental_transform: smoothTextStream(),
              onError: (err) => {
                taskStore.updateTask(item.query, { state: "failed" });
                handleError(err);
              },
            });
          }
          for await (const part of searchResult.fullStream) {
            if (part.type === "text-delta") {
              content += part.textDelta;
              taskStore.updateTask(item.query, { learning: content });
            } else if (part.type === "reasoning") {
              console.log("reasoning", part.textDelta);
            } else if (part.type === "source") {
              sources.push(part.source);
            } else if (part.type === "finish") {
              if (part.providerMetadata?.google) {
                const { groundingMetadata } = part.providerMetadata.google;
                const googleGroundingMetadata =
                  groundingMetadata as GoogleGenerativeAIProviderMetadata["groundingMetadata"];
                if (googleGroundingMetadata?.groundingSupports) {
                  googleGroundingMetadata.groundingSupports.forEach(
                    ({ segment, groundingChunkIndices }) => {
                      if (segment.text && groundingChunkIndices) {
                        const index = groundingChunkIndices.map(
                          (idx: number) => `[${idx + 1}]`
                        );
                        content = content.replaceAll(
                          segment.text,
                          `${segment.text}${index.join("")}`
                        );
                      }
                    }
                  );
                }
              } else if (part.providerMetadata?.openai) {
                // Fixed the problem that OpenAI cannot generate markdown reference link syntax properly in Chinese context
                content = content.replaceAll("【", "[").replaceAll("】", "]");
              }
            }
          }
          if (sources.length > 0) {
            content +=
              "\n\n" +
              sources
                .map(
                  (item, idx) =>
                    `[${idx + 1}]: ${item.url}${
                      item.title ? ` "${item.title.replaceAll('"', " ")}"` : ""
                    }`
                )
                .join("\n");
          }
          taskStore.updateTask(item.query, {
            state: "completed",
            learning: content,
            sources,
          });
          return content;
        });
      })
    );
  }

  async function reviewSearchResult() {
    const { language } = useSettingStore.getState();
    const { reportPlan, tasks, suggestion } = useTaskStore.getState();
    const { thinkingModel } = getModel();
    setStatus(t("research.common.research"));
    const learnings = tasks.map((item) => item.learning);
    const result = streamText({
      model: createProvider(thinkingModel),
      system: getSystemPrompt(),
      prompt: [
        reviewSerpQueriesPrompt(reportPlan, learnings, suggestion),
        getResponseLanguagePrompt(language),
      ].join("\n\n"),
      experimental_transform: smoothTextStream(),
      onError: handleError,
    });

    const querySchema = getSERPQuerySchema();
    let content = "";
    let queries = [];
    for await (const textPart of result.textStream) {
      content += textPart;
      const data: PartialJson = parsePartialJson(removeJsonMarkdown(content));
      if (
        querySchema.safeParse(data.value) &&
        data.state === "successful-parse"
      ) {
        if (data.value) {
          queries = data.value.map(
            (item: { query: string; researchGoal: string }) => ({
              state: "unprocessed",
              learning: "",
              ...pick(item, ["query", "researchGoal"]),
            })
          );
        }
      }
    }
    if (queries.length > 0) {
      taskStore.update([...tasks, ...queries]);
      await runSearchTask(queries);
    }
  }

  async function writeFinalReport() {
    const { language } = useSettingStore.getState();
    const {
      reportPlan,
      tasks,
      setId,
      setTitle,
      setSources,
      requirement,
      updateFinalReport,
    } = useTaskStore.getState();
    const { save } = useHistoryStore.getState();
    const { thinkingModel } = getModel();
    setStatus(t("research.common.writing"));
    updateFinalReport("");
    setTitle("");
    setSources([]);
    const learnings = tasks.map((item) => item.learning);
    const sources: Source[] = unique(
      flat(tasks.map((item) => (item.sources ? item.sources : []))),
      (item) => item.url
    );
    const result = streamText({
      model: createProvider(thinkingModel),
      system: [getSystemPrompt(), outputGuidelinesPrompt].join("\n\n"),
      prompt: [
        writeFinalReportPrompt(
          reportPlan,
          learnings,
          sources.map((item) => pick(item, ["title", "url"])),
          requirement
        ),
        getResponseLanguagePrompt(language),
      ].join("\n\n"),
      experimental_transform: smoothTextStream(),
      onError: handleError,
    });
    let content = "";
    for await (const textPart of result.textStream) {
      content += textPart;
      updateFinalReport(content);
    }
    if (sources.length > 0) {
      content +=
        "\n\n" +
        sources
          .map(
            (item, idx) =>
              `[${idx + 1}]: ${item.url}${
                item.title ? ` "${item.title.replaceAll('"', " ")}"` : ""
              }`
          )
          .join("\n");
      updateFinalReport(content);
    }
    const title = content
      .split("\n")[0]
      .replaceAll("#", "")
      .replaceAll("*", "")
      .trim();
    setTitle(title);
    setSources(sources);
    const id = save(taskStore.backup());
    setId(id);
    return content;
  }

  async function deepResearch() {
    const { language } = useSettingStore.getState();
    const { reportPlan } = useTaskStore.getState();
    const { thinkingModel } = getModel();
    setStatus(t("research.common.thinking"));
    try {
      let queries = [];
      const result = streamText({
        model: createProvider(thinkingModel),
        system: getSystemPrompt(),
        prompt: [
          generateSerpQueriesPrompt(reportPlan),
          getResponseLanguagePrompt(language),
        ].join("\n\n"),
        experimental_transform: smoothTextStream(),
        onError: handleError,
      });

      const querySchema = getSERPQuerySchema();
      let content = "";
      for await (const textPart of result.textStream) {
        content += textPart;
        const data: PartialJson = parsePartialJson(removeJsonMarkdown(content));
        if (querySchema.safeParse(data.value)) {
          if (
            data.state === "repaired-parse" ||
            data.state === "successful-parse"
          ) {
            if (data.value) {
              queries = data.value.map(
                (item: { query: string; researchGoal: string }) => ({
                  state: "unprocessed",
                  learning: "",
                  ...pick(item, ["query", "researchGoal"]),
                })
              );
              taskStore.update(queries);
            }
          }
        }
      }
      await runSearchTask(queries);
    } catch (err) {
      console.error(err);
    }
  }

  return {
    status,
    deepResearch,
    askQuestions,
    writeReportPlan,
    runSearchTask,
    reviewSearchResult,
    writeFinalReport,
  };
}

export default useDeepResearch;
