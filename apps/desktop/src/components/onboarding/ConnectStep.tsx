import { PrimaryButton, SecondaryButton, StepHeading } from "./_shared";

/**
 * Step 4 (already-connected variant) — shown when a company token is already
 * stored. The unpaired path renders the full PairingScreen instead (handled by
 * the wizard) so employees get the proven copy-link-to-admin flow.
 */
export default function ConnectStep({
  onContinue,
  onBack,
}: {
  onContinue: () => void;
  onBack: () => void;
}) {
  return (
    <div>
      <StepHeading title="Connect your account">
        This app is already linked to your company&apos;s Claude account.
      </StepHeading>

      <div className="mt-6 rounded-xl border border-success/30 bg-success/5 p-4">
        <div className="text-sm font-medium text-fg">Already connected ✓</div>
        <div className="mt-0.5 text-xs text-fg-dim">
          You can re-pair later from Settings if you ever need to.
        </div>
      </div>

      <div className="mt-8 flex gap-3">
        <SecondaryButton onClick={onBack}>Back</SecondaryButton>
        <div className="flex-1">
          <PrimaryButton onClick={onContinue}>Continue</PrimaryButton>
        </div>
      </div>
    </div>
  );
}
