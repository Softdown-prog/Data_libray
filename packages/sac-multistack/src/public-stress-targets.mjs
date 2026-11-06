// Reviewed, fixed public GitHub targets. Never accepts a tenant-supplied URL.
export const PUBLIC_STRESS_TARGETS=Object.freeze([
 Object.freeze({repo:'chromium/chromium',branch:'main',module:'cpp20',directory:'base'}),
 Object.freeze({repo:'kubernetes/kubernetes',branch:'master',module:'go',directory:'pkg/apis/core'}),
 Object.freeze({repo:'rust-lang/rust',branch:'main',module:'rust',directory:'library/core/src'}),
 Object.freeze({repo:'microsoft/TypeScript',branch:'main',module:'javascript',directory:'packages/typescript/src/ast'}),
 Object.freeze({repo:'golang/go',branch:'master',module:'go',directory:'src/go/ast'})
]);
export const PUBLIC_STRESS_LIMITS=Object.freeze({
 api_bytes_per_request:2097152,
 max_tree_entries:4000,
 max_tree_requests_per_repo:6,
 max_blobs_per_repo:3,
 max_blob_bytes:32768,
 max_total_blob_bytes_per_repo:98304,
 max_elapsed_ms_per_repo:60000
});
