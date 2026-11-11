import type { ComponentProps } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Icon } from "@/components/ui/icon";

import styles from "./pagination.module.css";

interface PaginationProps {
  readonly currentPage: number;
  readonly totalPages: number;
  readonly hrefForPage: (page: number) => ComponentProps<typeof Link>["href"];
  readonly label?: string | undefined;
}

export function Pagination({
  currentPage,
  totalPages,
  hrefForPage,
  label = "Pagination"
}: PaginationProps) {
  const pages = Array.from({ length: totalPages }, (_, index) => index + 1);
  return (
    <nav className={styles.pagination} aria-label={label}>
      {currentPage > 1 ? (
        <Link href={hrefForPage(currentPage - 1)} aria-label="Previous page">
          <Icon icon={ChevronLeft} />
        </Link>
      ) : (
        <span aria-disabled="true">
          <Icon icon={ChevronLeft} />
        </span>
      )}
      {pages.map((page) => (
        <Link
          key={page}
          href={hrefForPage(page)}
          aria-current={page === currentPage ? "page" : undefined}
        >
          <span className="visually-hidden">Page </span>
          {page}
        </Link>
      ))}
      {currentPage < totalPages ? (
        <Link href={hrefForPage(currentPage + 1)} aria-label="Next page">
          <Icon icon={ChevronRight} />
        </Link>
      ) : (
        <span aria-disabled="true">
          <Icon icon={ChevronRight} />
        </span>
      )}
    </nav>
  );
}
