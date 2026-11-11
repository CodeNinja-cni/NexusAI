import { redirect } from "next/navigation";
import type { Route } from "next";

export default function AdminPage() {
  redirect("/admin/dashboard" as Route);
}
