export const agentReviewVersion = 1

export type AgentResolution = {
  choice: 'current' | 'draft'
  currentHash: string | null
  beforeHash: string | null
  afterHash: string | null
}
