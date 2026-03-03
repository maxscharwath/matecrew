"use client";

import { useEffect } from "react";

export function OfficeCookie({ officeId }: { readonly officeId: string }) {
  useEffect(() => {
    document.cookie = `officeId=${officeId};path=/;samesite=lax;max-age=31536000`;
  }, [officeId]);

  return null;
}
