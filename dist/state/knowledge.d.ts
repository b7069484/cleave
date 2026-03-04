export interface KnowledgeMetrics {
    insightCount: number;
    coreSizeBytes: number;
    sessionSizeBytes: number;
}
export declare function parseKnowledgeMetrics(content: string): KnowledgeMetrics;
export declare function compactKnowledge(content: string, maxSessions: number): string;
