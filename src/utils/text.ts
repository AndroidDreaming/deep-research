const MAX_TEXT_CHUNK_LENGTH = 2000; // 你可以根据需要调整这个值

export function splitText(
  text: string = "",
  maxLength: number = MAX_TEXT_CHUNK_LENGTH
): string[] {
  const paragraphs = text.split("\n");
  const chunks: string[] = [];
  let currentChunk = "";

  for (const paragraph of paragraphs) {
    if (currentChunk.length + paragraph.length + 1 <= maxLength) {
      // +1 是为了加上换行符
      currentChunk += (currentChunk.length > 0 ? "\n" : "") + paragraph;
    } else {
      if (currentChunk.length > 0) {
        chunks.push(currentChunk);
      }
      currentChunk = paragraph;
    }
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }

  return chunks;
}

export function removeJsonMarkdown(text: string) {
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

export class ThinkTagStreamProcessor {
  private buffer: string = "";
  private hasSkippedThinkBlock: boolean = false;

  /**
   * Process the received text block.
   * @param chunk The received text block.
   * @param outputCallback The callback function called when there is non-thinking content to be output.
   */
  processChunk(
    chunk: string,
    contentOutput: (data: string) => void,
    thinkingOutput?: (data: string) => void
  ): void {
    // If the think block has been skipped, all new data is output directly
    if (this.hasSkippedThinkBlock) {
      contentOutput(chunk);
      return;
    }

    // Otherwise, while still looking for or processing a think block, add the new block to the buffer
    this.buffer += chunk;

    const startTag = this.buffer.startsWith("<think>");
    const endTagIndex = this.buffer.indexOf("</think>");

    if (startTag) {
      if (endTagIndex !== -1) {
        const contentAfterThink = this.buffer.substring(
          endTagIndex + "</think>".length
        );

        // Output the content after </think>
        if (contentAfterThink.length > 0) {
          contentOutput(contentAfterThink);
        }

        this.hasSkippedThinkBlock = true;
        this.buffer = "";
      } else {
        if (thinkingOutput) thinkingOutput(chunk);
      }
    } else {
      this.hasSkippedThinkBlock = true;
      contentOutput(chunk);
    }
  }
  end(): void {
    this.buffer = "";
    this.hasSkippedThinkBlock = false;
  }
}
