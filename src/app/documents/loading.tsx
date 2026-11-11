import { Skeleton } from "@/components/feedback/skeleton";

export default function DocumentsLoading() {
  return (
    <div style={{ display: "grid", gap: "1rem", padding: "3rem" }} aria-label="Loading documents">
      <Skeleton height="8rem" />
      <Skeleton height="12rem" />
      <Skeleton height="5rem" />
      <Skeleton height="14rem" />
    </div>
  );
}
