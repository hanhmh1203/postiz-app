import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { GeneratorDto } from '@gitroom/nestjs-libraries/dtos/generator/generator.dto';
import { z } from 'zod';

const CodexContentSchema = z.object({
  hook: z.string().min(1),
  content: z
    .array(
      z.object({
        content: z.string().min(1),
        website: z.string().optional(),
        prompt: z.string().optional(),
      })
    )
    .min(1),
  category: z.string().min(1),
  topic: z.string().min(1),
});

export type CodexGeneratedContent = z.infer<typeof CodexContentSchema>;

export type CodexGenerationEvent = {
  name: string;
  data?: {
    output: CodexGeneratedContent & { date: string };
  };
};

@Injectable()
export class CodexContentService {
  async generate(body: GeneratorDto): Promise<CodexGeneratedContent> {
    const bridgeUrl = process.env.CODEX_BRIDGE_URL?.replace(/\/$/, '');
    const bridgeToken = process.env.CODEX_BRIDGE_TOKEN;

    if (!bridgeUrl) {
      throw new ServiceUnavailableException(
        'CODEX_BRIDGE_URL is not configured for the local Codex provider'
      );
    }
    if (!bridgeToken) {
      throw new ServiceUnavailableException(
        'CODEX_BRIDGE_TOKEN is not configured for the local Codex provider'
      );
    }

    try {
      const response = await fetch(`${bridgeUrl}/v1/generate-social-posts`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${bridgeToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(
          Number(process.env.CODEX_BRIDGE_REQUEST_TIMEOUT_MS || 260_000)
        ),
      });

      if (!response.ok) {
        throw new ServiceUnavailableException(
          `Local Codex bridge returned HTTP ${response.status}`
        );
      }

      const parsed = CodexContentSchema.safeParse(await response.json());
      if (!parsed.success) {
        throw new ServiceUnavailableException(
          'Local Codex bridge returned invalid content'
        );
      }

      return parsed.data;
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      throw new ServiceUnavailableException(
        'Could not reach the local Codex bridge'
      );
    }
  }

  async *stream(
    body: GeneratorDto,
    findDate: () => Promise<string>
  ): AsyncGenerator<CodexGenerationEvent> {
    yield { name: 'agent' };
    yield { name: 'generate-hook' };
    yield { name: 'generate-content' };
    const generated = await this.generate(body);
    yield { name: 'post-time' };
    const date = await findDate();
    yield {
      name: 'codex-complete',
      data: {
        output: {
          ...generated,
          date,
        },
      },
    };
  }
}
