import { Global, Module } from '@nestjs/common';
import { AgentGraphService } from '@gitroom/nestjs-libraries/agent/agent.graph.service';
import { AgentGraphInsertService } from '@gitroom/nestjs-libraries/agent/agent.graph.insert.service';
import { CodexContentService } from '@gitroom/nestjs-libraries/agent/codex-content.service';

@Global()
@Module({
  providers: [AgentGraphService, AgentGraphInsertService, CodexContentService],
  get exports() {
    return this.providers;
  },
})
export class AgentModule {}
