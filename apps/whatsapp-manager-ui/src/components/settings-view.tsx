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
  onResetWorkspaceState,
}: {
  branding: BrandingSettings;
  defaultBranding: BrandingSettings;
  isBusy: boolean;
  onSave: (branding: BrandingSettings) => void;
  onResetWorkspaceState: () => void;
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
      <div className="number-header settings-header">
        <div className="subnav" aria-label="Settings sections">
          <span className="settings-tab-label">General</span>
        </div>
      </div>

      <div className="number-view-scroll settings-view-scroll">
        <section className="branding-form">
          <div className="section-heading-row">
            <div>
              <h2>General</h2>
              <p>Manage the dashboard name, icon, and browser workspace state.</p>
            </div>
          </div>

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
            <IconButton icon="mdi:tab-remove" label="Reset browser workspace state" type="button" variant="secondary" onClick={onResetWorkspaceState} disabled={isBusy}>
              Reset workspace
            </IconButton>
          </div>
        </section>
      </div>
    </>
  );
}
