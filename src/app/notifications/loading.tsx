import { SkeletonCard } from "@/components/feedback/skeleton";

export default function NotificationsLoading() {
  return (
    <div aria-label="Loading notifications">
      <SkeletonCard />
      <SkeletonCard />
      <SkeletonCard />
    </div>
  );
}
