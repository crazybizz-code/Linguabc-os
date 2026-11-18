import type { Tone } from "@/components/ui/primitives";

export const MOCK_TONE: Record<string, Tone> = { scheduled: "blue", in_progress: "amber", completed: "green", cancelled: "neutral" };
export const MOCK_LABEL: Record<string, string> = { scheduled: "Upcoming", in_progress: "In progress", completed: "Completed", cancelled: "Cancelled" };
