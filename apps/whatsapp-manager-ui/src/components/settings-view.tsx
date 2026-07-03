import { FormEvent, useEffect, useState } from "react";

import type { BrandingSettings } from "../domain/models";
import { IconButton } from "./shared";

export function SettingsView({
  branding,
  defaultBranding,
  isBusy,
  onReset,
  onSave,
}: {
  branding: BrandingSettings;
  defaultBranding: BrandingSettings;
  isBusy: boolean;
  onReset: () => void;
  onSave: (branding: BrandingSettings) => void;
}) {
  const [draftTitle, setDraftTitle] = useState(branding.title);
  const [draftIconSrc, setDraftIconSrc] = useState(branding.iconSrc);

  useEffect(() => {
    setDraftTitle(branding.title);
    setDraftIconSrc(branding.iconSrc);
  }, [branding]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSave({
      title: draftTitle,
      iconSrc: draftIconSrc,
    });
  }

  function uploadIcon(file: File | undefined) {
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setDraftIconSrc(reader.result);
      }
    };
    reader.readAsDataURL(file);
  }

  return (
    <>
      <form className="branding-form" onSubmit={submit}>
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
          <span>Icon URL</span>
          <input
            value={draftIconSrc}
            onChange={(event) => setDraftIconSrc(event.target.value)}
            placeholder={defaultBranding.iconSrc}
          />
        </label>

        <label className="field">
          <span>Upload icon</span>
          <input
            accept="image/*"
            type="file"
            onChange={(event) => uploadIcon(event.target.files?.[0])}
          />
        </label>

        <div className="settings-actions">
          <IconButton icon="mdi:content-save-outline" label="Save branding" type="submit" disabled={isBusy || !draftTitle.trim()} />
          <IconButton icon="mdi:restore" label="Reset branding" type="button" variant="secondary" onClick={onReset} disabled={isBusy} />
        </div>
      </form>
    </>
  );
}
