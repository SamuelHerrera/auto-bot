import type { BrandingSettings } from "../domain/models";

export const defaultAppTitle =
  import.meta.env.VITE_WHATSAPP_MANAGER_UI_TITLE?.trim() || "Auto Bot WhatsApp Bridge";
export const defaultAppIcon = "/auto-bot-mark.svg";

export const brandingStorageKeys = {
  title: "whatsapp-manager-ui.branding-title",
  iconSrc: "whatsapp-manager-ui.branding-icon-src",
};

export function getInitialBranding(): BrandingSettings {
  return normalizeBranding({
    title: localStorage.getItem(brandingStorageKeys.title) || defaultAppTitle,
    iconSrc: localStorage.getItem(brandingStorageKeys.iconSrc) || defaultAppIcon,
  });
}

export function normalizeBranding(branding: BrandingSettings): BrandingSettings {
  return {
    title: branding.title.trim() || defaultAppTitle,
    iconSrc: branding.iconSrc.trim() || defaultAppIcon,
  };
}

export function setFavicon(iconSrc: string) {
  const existingIcon = document.querySelector<HTMLLinkElement>("link[rel='icon']");
  const icon = existingIcon ?? document.createElement("link");
  icon.rel = "icon";
  icon.type = iconSrc.startsWith("data:image/svg") || iconSrc.endsWith(".svg") ? "image/svg+xml" : "image/png";
  icon.href = iconSrc;
  if (!existingIcon) {
    document.head.appendChild(icon);
  }
}
