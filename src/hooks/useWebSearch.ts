import { useSettingStore } from "@/store/setting";
import {
  createSearchProvider,
  type SearchProviderOptions,
} from "@/utils/deep-research/search";
import { multiApiKeyPolling } from "@/utils/model";
import { generateSignature } from "@/utils/signature";

function useWebSearch() {
  async function search(query: string) {
    const { mode, searchProvider, searchMaxResult, accessPassword } =
      useSettingStore.getState();
    const options: SearchProviderOptions = {
      provider: searchProvider,
      maxResult: searchMaxResult,
      query,
    };

    switch (searchProvider) {
      case "tavily":
        const { tavilyApiKey, tavilyApiProxy } = useSettingStore.getState();
        if (mode === "local") {
          options.baseURL = tavilyApiProxy;
          options.apiKey = multiApiKeyPolling(tavilyApiKey);
        } else {
          options.baseURL = "/api/search/tavily";
        }
        break;
      case "firecrawl":
        const { firecrawlApiKey, firecrawlApiProxy } =
          useSettingStore.getState();
        if (mode === "local") {
          options.baseURL = firecrawlApiProxy;
          options.apiKey = multiApiKeyPolling(firecrawlApiKey);
        } else {
          options.baseURL = "/api/search/firecrawl";
        }
        break;
      case "exa":
        const { exaApiKey, exaApiProxy } = useSettingStore.getState();
        if (mode === "local") {
          options.baseURL = exaApiProxy;
          options.apiKey = multiApiKeyPolling(exaApiKey);
        } else {
          options.baseURL = "/api/search/exa";
        }
        break;
      case "bocha":
        const { bochaApiKey, bochaApiProxy } = useSettingStore.getState();
        if (mode === "local") {
          options.baseURL = bochaApiProxy;
          options.apiKey = multiApiKeyPolling(bochaApiKey);
        } else {
          options.baseURL = "/api/search/bocha";
        }
        break;
      case "searxng":
        const { searxngApiProxy } = useSettingStore.getState();
        if (mode === "local") {
          options.baseURL = searxngApiProxy;
        } else {
          options.baseURL = "/api/search/searxng";
        }
        break;
      default:
        break;
    }

    if (mode === "proxy") {
      options.apiKey = generateSignature(accessPassword, Date.now());
    }
    return createSearchProvider(options);
  }

  return { search };
}

export default useWebSearch;
