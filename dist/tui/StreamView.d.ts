import type { ParsedEvent } from '../stream/types.js';
interface StreamViewProps {
    events: ParsedEvent[];
    maxVisible?: number;
}
export declare function StreamView({ events, maxVisible }: StreamViewProps): import("react/jsx-runtime").JSX.Element;
export {};
