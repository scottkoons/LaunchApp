declare namespace Cloudflare {
  interface Env {
    FILES: R2Bucket;
    OPENAI_API_KEY?: string;
    VAPID_PUBLIC_KEY?: string;
    VAPID_PRIVATE_KEY?: string;
    PUSH_DISPATCH_SECRET?: string;
  }
}
