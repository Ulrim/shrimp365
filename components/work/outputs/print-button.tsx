"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/work/ui/button";

export function PrintButton({ label = "인쇄 / PDF 저장" }: { label?: string }) {
  return (
    <Button variant="outline" className="no-print" onClick={() => window.print()}>
      <Printer /> {label}
    </Button>
  );
}
