import Link from "next/link";
import { ArrowLeftIcon } from "@/components/icons";

export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="group inline-flex items-center gap-2 rounded-full border border-line px-4 py-2 text-sm text-fg-muted transition-colors hover:border-line-strong hover:text-fg"
    >
      <ArrowLeftIcon size={16} className="transition-transform group-hover:-translate-x-0.5" />
      {label}
    </Link>
  );
}
