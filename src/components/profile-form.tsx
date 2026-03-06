"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { Building2, Camera, ExternalLink, Star, X } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { updateProfile } from "@/app/profile/actions";

interface ProfileFormProps {
  readonly user: {
    name: string;
    email: string;
    locale: string;
    defaultOfficeId: string | null;
  };
  readonly avatarUrl?: string;
  readonly offices: { id: string; name: string }[];
}

export function ProfileForm({ user, avatarUrl, offices }: ProfileFormProps) {
  const [isPending, startTransition] = useTransition();
  const [previewUrl, setPreviewUrl] = useState(avatarUrl);
  const [removeAvatar, setRemoveAvatar] = useState(false);
  const [selectedDefault, setSelectedDefault] = useState(
    user.defaultOfficeId ?? offices[0]?.id ?? "",
  );
  const fileInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const t = useTranslations();

  const initials = user.name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setRemoveAvatar(false);
    setPreviewUrl(URL.createObjectURL(file));
  }

  function handleRemoveAvatar() {
    setRemoveAvatar(true);
    setPreviewUrl(undefined);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  function handleSubmit(formData: FormData) {
    if (removeAvatar) {
      formData.set("removeAvatar", "true");
    }
    formData.set("defaultOfficeId", selectedDefault);
    startTransition(async () => {
      const result = await updateProfile(formData);
      if (result.success) {
        toast.success(t("profile.profileSaved"));
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <form action={handleSubmit} className="max-w-2xl space-y-6">
      {/* Profile card */}
      <Card>
        <CardContent className="space-y-6 pt-6">
          <div className="flex items-center gap-4">
            <Avatar className="size-16">
              <AvatarImage src={previewUrl} alt={user.name} />
              <AvatarFallback className="text-lg">{initials}</AvatarFallback>
            </Avatar>
            <div className="space-y-1.5">
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Camera className="mr-1.5 size-3.5" />
                  {t("profile.changeAvatar")}
                </Button>
                {previewUrl && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={handleRemoveAvatar}
                  >
                    <X className="size-3.5" />
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">PNG, JPG. 2 MB max.</p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              name="avatar"
              accept="image/png,image/jpeg"
              className="hidden"
              onChange={handleFileChange}
            />
          </div>

          <Separator />

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="name">{t("profile.name")}</Label>
              <Input
                id="name"
                name="name"
                required
                defaultValue={user.name}
                placeholder={t("profile.namePlaceholder")}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">{t("auth.email")}</Label>
              <Input id="email" value={user.email} disabled />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="locale">{t("profile.language")}</Label>
            <Select name="locale" defaultValue={user.locale}>
              <SelectTrigger id="locale" className="sm:w-1/2">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="fr">Francais</SelectItem>
                <SelectItem value="en">English</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex justify-end">
            <Button type="submit" disabled={isPending}>
              {isPending ? t("profile.saving") : t("profile.saveChanges")}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Offices card */}
      {offices.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{t("profile.offices")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {offices.map((o) => {
              const isDefault = o.id === selectedDefault;
              return (
                <div
                  key={o.id}
                  className="flex items-center justify-between rounded-lg border px-4 py-3"
                >
                  <div className="flex items-center gap-3">
                    <Building2 className="size-4 text-muted-foreground" />
                    <span className="text-sm font-medium">{o.name}</span>
                    {isDefault && (
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                        {t("profile.default")}
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    {!isDefault && offices.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs text-muted-foreground"
                        onClick={() => setSelectedDefault(o.id)}
                      >
                        <Star className="mr-1 size-3" />
                        {t("profile.setAsDefault")}
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => router.push(`/org/${o.id}/dashboard`)}
                    >
                      <ExternalLink className="mr-1 size-3" />
                      {t("profile.goToOffice")}
                    </Button>
                  </div>
                </div>
              );
            })}
            {offices.length > 1 && (
              <p className="pt-1 text-xs text-muted-foreground">
                {t("profile.defaultOfficeDescription")}
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </form>
  );
}
