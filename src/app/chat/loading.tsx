import { Skeleton } from "@/components/feedback/skeleton";

export default function ChatLoading() {
  return (
    <div
      style={{ display: "grid", gap: "1rem", padding: "3rem" }}
      aria-label="Loading conversations"
    >
      <Skeleton height="5rem" />
      <Skeleton height="9rem" />
      <Skeleton height="4rem" />
      <Skeleton height="4rem" />
    </div>
  );
}
