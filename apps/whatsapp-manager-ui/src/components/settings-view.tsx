import { useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";

import type { BrandingSettings } from "../domain/models";
import { IconButton } from "./shared";

const titleAutosaveDelayMs = 1200;

export function SettingsView({
  branding,
  defaultBranding,
  isBusy,
  onSave,
}: {
  branding: BrandingSettings;
  defaultBranding: BrandingSettings;
  isBusy: boolean;
  onSave: (branding: BrandingSettings) => void;
}) {
  const [draftTitle, setDraftTitle] = useState(branding.title);
  const [draftIconSrc, setDraftIconSrc] = useState(branding.iconSrc);
  const iconInputRef = useRef<HTMLInputElement>(null);
  const onSaveRef = useRef(onSave);

  useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);

  useEffect(() => {
    setDraftTitle(branding.title);
    setDraftIconSrc(branding.iconSrc);
  }, [branding]);

  useEffect(() => {
    if (draftTitle === branding.title && draftIconSrc === branding.iconSrc) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      onSaveRef.current({ title: draftTitle, iconSrc: draftIconSrc });
    }, titleAutosaveDelayMs);

    return () => window.clearTimeout(timeoutId);
  }, [branding.iconSrc, branding.title, draftIconSrc, draftTitle]);

  function uploadIcon(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setDraftIconSrc(reader.result);
        onSaveRef.current({ title: draftTitle, iconSrc: reader.result });
      }
    };
    reader.readAsDataURL(file);
  }

  function clearIcon() {
    setDraftIconSrc(defaultBranding.iconSrc);
    onSaveRef.current({ title: draftTitle, iconSrc: defaultBranding.iconSrc });
    if (iconInputRef.current) {
      iconInputRef.current.value = "";
    }
  }

  return (
    <>
      <section className="branding-form">
        <div className="branding-preview">
          <img src={draftIconSrc || defaultBranding.iconSrc} alt="" aria-hidden="true" />
          <strong>{draftTitle.trim() || defaultBranding.title}</strong>
        </div>

        <label className="field">
          <span>App title</span>
          <input
            value={draftTitle}
            onChange={(event) => setDraftTitle(event.target.value)}
            placeholder={defaultBranding.title}
          />
        </label>

        <label className="field">
          <span>Upload icon</span>
          <input
            accept="image/*"
            ref={iconInputRef}
            type="file"
            onChange={uploadIcon}
          />
        </label>

        <div className="settings-actions">
          <IconButton icon="mdi:image-remove-outline" label="Clear icon" type="button" variant="secondary" onClick={clearIcon} disabled={isBusy || draftIconSrc === defaultBranding.iconSrc}>
            Clear icon
          </IconButton>
        </div>
      </section>
    </>
  );
}
