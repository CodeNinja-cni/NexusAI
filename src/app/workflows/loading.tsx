import { Skeleton } from "@/components/feedback/skeleton";

export default function WorkflowsLoading() {
  return (
    <div style={{ display: "grid", gap: "1rem", padding: "3rem" }} aria-label="Loading workflows">
      <Skeleton height="9rem" />
      <Skeleton height="7rem" />
      <Skeleton height="18rem" />
    </div>
  );
}
