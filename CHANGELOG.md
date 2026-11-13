**English** · [Deutsch](CHANGELOG.de.md)

# Changelog

All notable changes to TillSplit. Versions follow [Semantic Versioning](https://semver.org/);
Docker images: `t3chdocklabs/tillsplit:<version>` and `ghcr.io/t3chdock-labs/tillsplit:<version>`.

## [0.1.4] – 2026-11-13

### Added
- **Refunds:** account for returned goods. On the purchase receipt choose "Record return" and tick the returned
  items (the refunded amount can be changed) – or upload the refund document like a receipt. The refund carries
  negative amounts, is linked to the purchase and is assigned to the credit in Actual, to the same areas as the
  purchase. The overview deducts it from the spending of the product group.
- **The purchase is found automatically:** by order number, otherwise by store and refunded items. If the purchase
  is not unambiguous, the refund lists the possible receipts to choose from.
- The credit is searched for up to 45 days after the return; late credits only if the payee matches the store.
  The same return recorded twice (by hand and as a document) is flagged as a possible duplicate.
- **Price changes:** the bottom of the overview shows what has become more expensive and what has become cheaper –
  the 100 largest changes in percent per list. The last price in the period is compared with the price before, per
  item and store. A click shows all purchases of the item in that store.

## [0.1.3] – 2026-11-11

### Added
- **Combined booking:** book several receipts to one debit together, e.g. several Amazon invoices that are
  charged as one payment. In the receipt list choose "Book together", tick the receipts and pick the debit
  matching their total; it is split in Actual by the areas of all receipts. Also works afterwards for receipts
  that were already uploaded.
- **Suggestions during matching:** if several open receipts from the same store add up to exactly one debit,
  TillSplit suggests the combined booking – it is only booked after you confirm.
- The receipt page lists all receipts of a combined booking; "Dissolve combined booking" undoes the split in
  Actual. Changing one receipt re-splits the whole booking; deleting one dissolves it.

## [0.1.2] – 2026-11-06

### Added
- **PDF viewer:** PDF receipts and invoices are shown directly on the receipt page (pdf.js), also on phones
  where the browser can't display PDFs in a frame. Tap to zoom, link "Open PDF".
- **Thumbnails** in the receipt list: first page for PDFs (with a small "PDF" badge), photos are scaled down
  so the list loads faster.
- **Overview filter by Actual account:** show only receipts booked to one account (cash receipts count
  towards the cash account, receipts without an account appear as "No account"). Applies to all figures,
  charts, the previous-period comparison and the detail lists; remembered per device.
- **Setup wizard:** new step "Set up finances" with sub-items (further budgets, finance dashboard,
  categories per budget) that are detected as done automatically.
- **Automatic category mapping:** Actual categories with the same name as a product group are assigned
  automatically when an Actual budget is connected or added; button "Assign by name" for the rest.

### Changed
- **Product groups:** choose the Actual budget at the top, then one category per group – groups are listed
  below each other at full width (readable on phone and desktop); the category selection is searchable.
- Hints in Admin and Settings: further budgets of the same Actual server are chosen in Settings,
  no second household needed.
- `docker-stack.yml`: commented NFS example for the backup volume.

### Fixed
- Setup wizard: "Assign categories per budget" was not marked as done.

## [0.1.1] – 2026-11-04

### Added
- Reasoning effort, Ollama server, text model (Tesseract) and backup schedule can be set in the interface;
  environment variables are only initial values.
- README: configuration section and ready-made images.

### Changed
- English environment variable names (e.g. `REQUIRE_2FA`, `TILLSPLIT_KEY`, `SOURCE_URL`, `DONATE_URL`);
  the German names from 0.1.0 still work.
- Donate button points to the project by default, `DONATE_URL=off` hides it.
- `docker-stack.yml` slimmed down and commented in English, Actual configured entirely in the interface,
  Traefik labels commented out.
- Version shown as SemVer everywhere (`0.1.1` instead of `0.1.01`).

## [0.1.0] – 2026-11-04

First public release.

[0.1.4]: https://github.com/t3chdock-labs/TillSplit/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/t3chdock-labs/TillSplit/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/t3chdock-labs/TillSplit/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/t3chdock-labs/TillSplit/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/t3chdock-labs/TillSplit/releases/tag/v0.1.0
