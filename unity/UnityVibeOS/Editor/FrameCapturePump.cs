using System.Collections;
using UnityEngine;

namespace UnityVibeOS
{
    /// <summary>
    /// Play-mode end-of-frame driver for <see cref="FrameCapture"/>. Lives on a HideAndDontSave
    /// GameObject for the duration of one capture session. WaitForEndOfFrame is only meaningful
    /// inside a running player loop — it is what makes ScreenCapture read the fully composited
    /// Game view — which is why edit mode uses FrameCapture's editor-tick path instead.
    ///
    /// In its own file because Unity requires a MonoBehaviour's file name to match its class name.
    /// </summary>
    internal sealed class FrameCapturePump : MonoBehaviour
    {
        public void StartCapture()
        {
            StartCoroutine(Run());
        }

        IEnumerator Run()
        {
            while (FrameCapture.WantsMoreFrames)
            {
                yield return new WaitForEndOfFrame();
                FrameCapture.GrabPlayModeFrame();
                // Space the frames out in unscaled time so a paused or slow-motion game still
                // captures on the wall clock the caller asked for.
                float wait = FrameCapture.IntervalMs / 1000f;
                float elapsed = 0f;
                while (elapsed < wait && FrameCapture.WantsMoreFrames)
                {
                    elapsed += Mathf.Max(Time.unscaledDeltaTime, 0.001f);
                    yield return null;
                }
            }
        }
    }
}
