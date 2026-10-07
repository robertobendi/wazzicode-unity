using UnityEditor;
using UnityEngine;

namespace UnityVibeOS
{
    /// <summary>
    /// Small shims over Editor APIs that changed across Unity versions, so call sites stay clean
    /// and warning-free. Unity 6.1 renamed instance IDs to "entity IDs" and marked
    /// <c>EditorUtility.InstanceIDToObject</c> obsolete; it still functions on every supported
    /// version, so older Editors route through it with the obsolete warning locally suppressed;
    /// 6.3+ uses <c>EditorUtility.EntityIdToObject</c>.
    /// </summary>
    internal static class EditorCompat
    {
        public static Object IdToObject(int id)
        {
#if UNITY_6000_3_OR_NEWER
            // 6.3+: the EntityId API is the supported path (int converts implicitly), so we stop
            // leaning on the obsolete InstanceIDToObject before a later release removes it.
            return EditorUtility.EntityIdToObject(id);
#else
#pragma warning disable CS0618
            return EditorUtility.InstanceIDToObject(id);
#pragma warning restore CS0618
#endif
        }
    }
}
