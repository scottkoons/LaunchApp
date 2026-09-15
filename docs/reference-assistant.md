# Reference board website commands

The Reference board's **Add from a website** form accepts a public HTTPS website and a plain-language command. The Business workspace defaults to Colorado Mountain Brewery's website. **Use menu example** fills a command to find the regular and happy hour menus; **Find and add** runs it.

The server reads the supplied page and up to four relevant linked pages on the same website. OpenAI selects document links only from that observed list. It receives the command and public links, not private tasks, contacts, or existing reference contents. Ambiguous or incomplete selections produce a clarification message and no additions.

Supported sources are public PDF, PNG, JPEG, WebP, GIF, and Adobe Publish Online documents offering a PDF download. The Adobe adapter reads the public manifest as JSON without executing scripts. It follows the viewer's published PDF path. There is no authenticated browsing, password handling, arbitrary JavaScript execution, or recreation of menu artwork by AI.

The authenticated download endpoint accepts only files in a recent, account-bound search receipt. Each redirect is checked for a public HTTPS URL and public DNS addresses. Downloaded content is bounded to 20 MB and checked by its file signature. Searches are limited to 20 per account per hour.

PDFs of up to 12 pages render into page images in the client using the existing PDF.js dependency. Each reference keeps its page images, original PDF, source URL, and saved date. Page controls appear in the image preview. The files and card are saved in one local IndexedDB transaction and then synced using Launch's existing authenticated D1/R2 flow. Active references with the same source URL in the workspace are reused on repeat commands; deleted cards can be added again. Importing is a snapshot, not ongoing monitoring for website updates.

Tests in `tests/reference-import.test.ts` cover page discovery, strict AI selection, Adobe PDF resolution, private-network and oversized-download rejection, duplicate saves, and offline persistence of originals and page images. A live public-source smoke test verified the Full Menu and Drink/Happy Hour Menu linked from cmbrew.com on September 15, 2026.
