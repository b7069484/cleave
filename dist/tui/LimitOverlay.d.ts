export type LimitType = 'sessions' | 'budget';
interface LimitOverlayProps {
    type: LimitType;
    currentValue: number;
    sessionNum: number;
    maxSessions: number;
    onConfirm: (newValue: number) => void;
    onCancel: () => void;
}
export declare function LimitOverlay({ type, currentValue, sessionNum, maxSessions, onConfirm, onCancel, }: LimitOverlayProps): import("react/jsx-runtime").JSX.Element;
export {};
