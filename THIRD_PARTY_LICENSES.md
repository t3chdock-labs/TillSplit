# Lizenzen von Drittanbietern

TillSplit selbst steht unter der GNU Affero General Public License v3.0 (siehe `LICENSE`).
TillSplit nutzt die folgenden Bibliotheken und Programme. Ihre Lizenztexte liegen jeweils im Paket (`node_modules/<paket>/LICENSE`) bzw. im Docker-Image unter `/usr/share/doc/<paket>/copyright`.

## Programme im Docker-Image

| Programm | Lizenz | Zweck |
|---|---|---|
| Node.js | MIT | Laufzeitumgebung |
| Tesseract OCR (tesseract-ocr, tesseract-ocr-deu) | Apache-2.0 | Texterkennung |
| Poppler (poppler-utils: pdftoppm, pdftotext) | GPL-2.0 / GPL-3.0 | PDF in Bild/Text umwandeln (eigenständiges Programm) |
| libheif (libheif-examples: heif-convert) | LGPL-3.0 / MIT | iPhone-Fotos (HEIC) umwandeln |
| PostgreSQL-Client (pg_dump) | PostgreSQL-Lizenz | Backups |
| tini | MIT | Prozessverwaltung im Container |
| Debian GNU/Linux (Basis-Image) | verschiedene freie Lizenzen | Betriebssystem; Quellcode unter https://sources.debian.org |

## Bibliotheken

| Paket | Version | Lizenz | Teil | Quelle |
|---|---|---|---|---|
| @actual-app/api | 26.11.0 | MIT | Server | https://github.com/actualbudget/actual |
| @actual-app/core | 26.11.0 | ISC | Server | https://github.com/actualbudget/actual |
| @actual-app/crdt | 3.1.4 | MIT | Server | https://github.com/actualbudget/actual |
| @anthropic-ai/sdk | 1.3.0 | Apache-2.0 | Server | github:anthropics/anthropic-sdk-typescript |
| @babel/runtime | 7.29.10 | MIT | Server | https://github.com/babel/babel |
| @bufbuild/protobuf | 2.16.0 | (Apache-2.0 AND BSD-3-Clause) | Server | https://github.com/bufbuild/protobuf-es |
| @fastify/accept-negotiator | 2.1.2 | MIT | Server | https://github.com/fastify/accept-negotiator |
| @fastify/ajv-compiler | 4.0.7 | MIT | Server | https://github.com/fastify/ajv-compiler |
| @fastify/busboy | 3.2.4 | MIT | Server | https://github.com/fastify/busboy |
| @fastify/cookie | 11.1.5 | MIT | Server | https://github.com/fastify/fastify-cookie |
| @fastify/deepmerge | 3.2.4 | MIT | Server | https://github.com/fastify/deepmerge |
| @fastify/error | 4.2.1 | MIT | Server | https://github.com/fastify/fastify-error |
| @fastify/fast-json-stringify-compiler | 5.1.1 | MIT | Server | https://github.com/fastify/fast-json-stringify-compiler |
| @fastify/forwarded | 3.1.2 | MIT | Server | https://github.com/fastify/forwarded |
| @fastify/helmet | 13.2.0 | MIT | Server | https://github.com/fastify/fastify-helmet |
| @fastify/merge-json-schemas | 0.2.2 | MIT | Server | https://github.com/fastify/merge-json-schemas |
| @fastify/multipart | 10.1.7 | MIT | Server | https://github.com/fastify/fastify-multipart |
| @fastify/proxy-addr | 5.1.2 | MIT | Server | https://github.com/fastify/proxy-addr |
| @fastify/rate-limit | 11.2.2 | MIT | Server | https://github.com/fastify/fastify-rate-limit |
| @fastify/send | 4.2.0 | MIT | Server | https://github.com/fastify/send |
| @fastify/static | 10.1.8 | MIT | Server | https://github.com/fastify/fastify-static |
| @hexagon/base64 | 1.1.28 | MIT | Server | https://github.com/hexagon/base64 |
| @img/colour | 1.1.0 | MIT | Server | https://github.com/lovell/colour |
| @img/sharp-win32-x64 | 0.35.5 | Apache-2.0 AND LGPL-3.0-or-later | Server | https://github.com/lovell/sharp |
| @jlongster/sql.js | 1.6.7 | MIT | Server | http://github.com/sql-js/sql.js |
| @levischuck/tiny-cbor | 0.2.11 | MIT | Server | https://github.com/levischuck/tiny-cbor |
| @lukeed/ms | 2.0.2 | MIT | Server | lukeed/ms |
| @opentelemetry/api | 1.10.0 | Apache-2.0 | Server | open-telemetry/opentelemetry-js |
| @peculiar/asn1-android | 2.11.1 | MIT | Server | https://github.com/PeculiarVentures/asn1-schema |
| @peculiar/asn1-asym-key | 2.11.1 | MIT | Server | https://github.com/PeculiarVentures/asn1-schema |
| @peculiar/asn1-cms | 2.11.1 | MIT | Server | https://github.com/PeculiarVentures/asn1-schema |
| @peculiar/asn1-csr | 2.11.1 | MIT | Server | https://github.com/PeculiarVentures/asn1-schema |
| @peculiar/asn1-ecc | 2.11.1 | MIT | Server | https://github.com/PeculiarVentures/asn1-schema |
| @peculiar/asn1-pfx | 2.11.1 | MIT | Server | https://github.com/PeculiarVentures/asn1-schema |
| @peculiar/asn1-pkcs8 | 2.11.1 | MIT | Server | https://github.com/PeculiarVentures/asn1-schema |
| @peculiar/asn1-pkcs9 | 2.11.1 | MIT | Server | https://github.com/PeculiarVentures/asn1-schema |
| @peculiar/asn1-rsa | 2.11.1 | MIT | Server | https://github.com/PeculiarVentures/asn1-schema |
| @peculiar/asn1-schema | 2.11.1 | MIT | Server | https://github.com/PeculiarVentures/asn1-schema |
| @peculiar/asn1-x509 | 2.11.1 | MIT | Server | https://github.com/PeculiarVentures/asn1-schema |
| @peculiar/asn1-x509-attr | 2.11.1 | MIT | Server | https://github.com/PeculiarVentures/asn1-schema |
| @peculiar/asn1-x509-post-quantum | 2.11.1 | MIT | Server | https://github.com/PeculiarVentures/asn1-schema |
| @peculiar/utils | 2.0.3 | MIT | Server | https://github.com/PeculiarVentures/pvtsutils |
| @peculiar/x509 | 2.2.0 | MIT | Server | https://github.com/PeculiarVentures/x509 |
| @pinojs/redact | 0.4.0 | MIT | Server | https://github.com/pinojs/redact |
| @remix-run/route-pattern | 0.22.1 | MIT | Oberfläche | https://github.com/remix-run/remix |
| @rschedule/core | 1.5.0 | Unlicense | Server | https://gitlab.com/john.carroll.p/rschedule |
| @rschedule/standard-date-adapter | 1.5.0 | Unlicense | Server | https://gitlab.com/john.carroll.p/rschedule |
| @simplewebauthn/browser | 14.0.0 | MIT | Oberfläche | https://github.com/MasterKale/SimpleWebAuthn |
| @simplewebauthn/server | 14.0.3 | MIT | Server | https://github.com/MasterKale/SimpleWebAuthn |
| @stablelib/base64 | 1.0.1 | MIT | Server | https://github.com/StableLib/stablelib |
| @types/react | 19.3.0 | MIT | Oberfläche | https://github.com/DefinitelyTyped/DefinitelyTyped |
| @types/react-dom | 19.3.0 | MIT | Oberfläche | https://github.com/DefinitelyTyped/DefinitelyTyped |
| abstract-logging | 2.0.1 | MIT | Server | https://github.com/jsumners/abstract-logging |
| absurd-sql | 0.0.54 | MIT | Server |  |
| ajv | 8.20.0 | MIT | Server | ajv-validator/ajv |
| ajv-formats | 3.0.1 | MIT | Server | https://github.com/ajv-validator/ajv-formats |
| ansi-regex | 5.0.1 | MIT | Server | chalk/ansi-regex |
| ansi-styles | 4.3.0 | MIT | Server | chalk/ansi-styles |
| asn1js | 3.1.0 | BSD-3-Clause | Server | https://github.com/PeculiarVentures/ASN1.js |
| atomic-sleep | 1.0.0 | MIT | Server | https://github.com/davidmarkclements/atomic-sleep |
| avvio | 9.3.1 | MIT | Server | https://github.com/fastify/avvio |
| balanced-match | 4.0.4 | MIT | Server | git://github.com/juliangruber/balanced-match |
| better-sqlite3 | 13.0.3 | MIT | Server | git://github.com/WiseLibs/better-sqlite3 |
| brace-expansion | 5.0.12 | MIT | Server | https://github.com/juliangruber/brace-expansion |
| camelcase | 5.3.1 | MIT | Server | sindresorhus/camelcase |
| chevrotain | 6.5.0 | Apache-2.0 | Server | git://github.com/SAP/chevrotain |
| cliui | 6.0.0 | ISC | Server | http://github.com/yargs/cliui |
| color-convert | 2.0.1 | MIT | Server | Qix-/color-convert |
| color-name | 1.1.4 | MIT | Server | git@github.com:colorjs/color-name |
| compare-versions | 6.1.1 | MIT | Server | https://github.com/omichelsen/compare-versions |
| content-disposition | 3.0.0 | MIT | Server | jshttp/content-disposition |
| cookie | 2.0.1 | MIT | Server | jshttp/cookie |
| cookie-es | 3.1.1 | MIT | Oberfläche | unjs/cookie-es |
| csstype | 3.2.3 | MIT | Oberfläche | https://github.com/frenic/csstype |
| csv-parse | 7.0.3 | MIT | Server | https://github.com/adaltas/node-csv |
| csv-stringify | 6.9.0 | MIT | Server | https://github.com/adaltas/node-csv |
| date-fns | 4.4.0 | MIT | Server | https://github.com/date-fns/date-fns |
| decamelize | 1.2.0 | MIT | Server | sindresorhus/decamelize |
| depd | 2.0.0 | MIT | Server | dougwilson/nodejs-depd |
| dequal | 2.0.3 | MIT | Server | lukeed/dequal |
| detect-libc | 2.1.2 | Apache-2.0 | Server | git://github.com/lovell/detect-libc |
| dijkstrajs | 1.0.3 | MIT | Server | git://github.com/tcort/dijkstrajs |
| echarts | 6.1.0 | Apache-2.0 | Oberfläche | https://github.com/apache/echarts |
| emoji-regex | 8.0.0 | MIT | Server | https://github.com/mathiasbynens/emoji-regex |
| es-toolkit | 1.53.1 | MIT | Server | https://github.com/toss/es-toolkit |
| escape-html | 1.0.3 | MIT | Server | component/escape-html |
| fast-decode-uri-component | 1.0.1 | MIT | Server | https://github.com/delvedor/fast-decode-uri-component |
| fast-deep-equal | 3.1.3 | MIT | Server | https://github.com/epoberezkin/fast-deep-equal |
| fast-json-stringify | 7.2.1 | MIT | Server | https://github.com/fastify/fast-json-stringify |
| fast-querystring | 1.1.2 | MIT | Server | https://github.com/anonrig/fast-querystring |
| fast-sha256 | 1.3.0 | Unlicense | Server | https://github.com/dchest/fast-sha256-js |
| fast-uri | 3.1.9 | BSD-3-Clause | Server | https://github.com/fastify/fast-uri |
| fast-uri | 4.2.3 | BSD-3-Clause | Server | https://github.com/fastify/fast-uri |
| fastify | 5.12.8 | MIT | Server | https://github.com/fastify/fastify |
| fastify-plugin | 6.0.1 | MIT | Server | https://github.com/fastify/fastify-plugin |
| fastq | 1.20.3 | ISC | Server | https://github.com/mcollina/fastq |
| fflate | 0.8.3 | MIT | Server | https://github.com/101arrowz/fflate |
| find-my-way | 9.10.0 | MIT | Server | https://github.com/delvedor/find-my-way |
| find-up | 4.1.0 | MIT | Server | sindresorhus/find-up |
| get-caller-file | 2.0.5 | ISC | Server | https://github.com/stefanpenner/get-caller-file |
| glob | 13.0.6 | BlueOak-1.0.0 | Server | git@github.com:isaacs/node-glob |
| handlebars | 4.7.10 | MIT | Server | https://github.com/handlebars-lang/handlebars.js |
| helmet | 8.3.0 | MIT | Server | git://github.com/helmetjs/helmet |
| http-errors | 2.0.1 | MIT | Server | jshttp/http-errors |
| hyperformula | 3.5.0 | GPL-3.0-only | Server | https://github.com/handsontable/hyperformula |
| inherits | 2.0.4 | ISC | Server | git://github.com/isaacs/inherits |
| ip-address | 10.7.5 | MIT | Server | https://github.com/beaugunderson/ip-address |
| ipaddr.js | 2.5.0 | MIT | Server | https://github.com/whitequark/ipaddr.js |
| is-fullwidth-code-point | 3.0.0 | MIT | Server | sindresorhus/is-fullwidth-code-point |
| json-schema-ref-resolver | 3.0.1 | MIT | Server | https://github.com/fastify/json-schema-ref-resolver |
| json-schema-to-ts | 3.1.1 | MIT | Server | https://github.com/ThomasAribart/json-schema-to-ts |
| json-schema-traverse | 1.0.0 | MIT | Server | https://github.com/epoberezkin/json-schema-traverse |
| light-my-request | 6.8.0 | BSD-3-Clause | Server | https://github.com/fastify/light-my-request |
| locate-path | 5.0.0 | MIT | Server | sindresorhus/locate-path |
| lru-cache | 11.5.3 | BlueOak-1.0.0 | Server | ssh://git@github.com/isaacs/node-lru-cache |
| mime | 3.0.0 | MIT | Server | https://github.com/broofa/mime |
| minimatch | 10.2.6 | BlueOak-1.0.0 | Server | git@github.com:isaacs/minimatch |
| minimist | 1.2.8 | MIT | Server | git://github.com/minimistjs/minimist |
| minipass | 7.1.3 | BlueOak-1.0.0 | Server | https://github.com/isaacs/minipass |
| mitt | 3.0.1 | MIT | Server | developit/mitt |
| murmurhash | 2.0.1 | MIT | Server | git://github.com/perezd/node-murmurhash |
| neo-async | 2.6.2 | MIT | Server | git@github.com:suguru03/neo-async |
| node-addon-api | 8.9.2 | MIT | Server | git://github.com/nodejs/node-addon-api |
| nodemailer | 7.0.13 | MIT-0 | Server | https://github.com/nodemailer/nodemailer |
| on-exit-leak-free | 2.1.2 | MIT | Server | https://github.com/mcollina/on-exit-or-gc |
| p-limit | 2.3.0 | MIT | Server | sindresorhus/p-limit |
| p-locate | 4.1.0 | MIT | Server | sindresorhus/p-locate |
| p-try | 2.2.0 | MIT | Server | sindresorhus/p-try |
| path-exists | 4.0.0 | MIT | Server | sindresorhus/path-exists |
| path-scurry | 2.0.2 | BlueOak-1.0.0 | Server | https://github.com/isaacs/path-scurry |
| pino | 10.4.0 | MIT | Server | https://github.com/pinojs/pino |
| pino-abstract-transport | 3.0.0 | MIT | Server | https://github.com/pinojs/pino-abstract-transport |
| pino-std-serializers | 7.1.0 | MIT | Server | ssh://git@github.com/pinojs/pino-std-serializers |
| pngjs | 5.0.0 | MIT | Server | git://github.com/lukeapage/pngjs |
| postgres | 4.0.0 | Unlicense | Server | porsager/postgres |
| process-warning | 5.1.1 | MIT | Server | https://github.com/fastify/process-warning |
| pvtsutils | 1.3.6 | MIT | Server | https://github.com/PeculiarVentures/pvtsutils |
| pvutils | 1.2.0 | MIT | Server | https://github.com/PeculiarVentures/pvutils |
| qrcode | 1.5.4 | MIT | Server | git://github.com/soldair/node-qrcode |
| quick-format-unescaped | 4.0.4 | MIT | Server | https://github.com/davidmarkclements/quick-format |
| react | 19.3.1 | MIT | Oberfläche | https://github.com/react/react |
| react-dom | 19.3.1 | MIT | Oberfläche | https://github.com/react/react |
| react-router | 8.5.1 | MIT | Oberfläche | https://github.com/remix-run/react-router |
| real-require | 1.0.0 | MIT | Server | https://github.com/pinojs/real-require |
| reflect-metadata | 0.2.2 | Apache-2.0 | Server | https://github.com/rbuckton/reflect-metadata |
| regexp-to-ast | 0.4.0 | MIT | Server | https://github.com/bd82/regexp-to-ast |
| require-directory | 2.1.1 | MIT | Server | git://github.com/troygoode/node-require-directory |
| require-from-string | 2.0.2 | MIT | Server | floatdrop/require-from-string |
| require-main-filename | 2.0.0 | ISC | Server | ssh://git@github.com/yargs/require-main-filename |
| ret | 0.5.1 | MIT | Server | git://github.com/fent/ret.js |
| reusify | 1.1.0 | MIT | Server | https://github.com/mcollina/reusify |
| rfdc | 1.4.1 | MIT | Server | https://github.com/davidmarkclements/rfdc |
| safari-14-idb-fix | 1.0.6 | Apache-2.0 | Server | https://github.com/jakearchibald/safari-14-idb-fix |
| safe-regex2 | 5.1.2 | MIT | Server | https://github.com/fastify/safe-regex2 |
| safe-stable-stringify | 2.5.0 | MIT | Server | https://github.com/BridgeAR/safe-stable-stringify |
| sax | 1.6.1 | BlueOak-1.0.0 | Server | ssh://git@github.com/isaacs/sax-js |
| scheduler | 0.28.0 | MIT | Oberfläche | https://github.com/react/react |
| secure-json-parse | 4.1.1 | BSD-3-Clause | Server | https://github.com/fastify/secure-json-parse |
| semver | 7.8.5 | ISC | Server | https://github.com/npm/node-semver |
| set-blocking | 2.0.0 | ISC | Server | https://github.com/yargs/set-blocking |
| set-cookie-parser | 3.2.2 | MIT | Server | nfriedly/set-cookie-parser |
| setprototypeof | 1.2.0 | ISC | Server | https://github.com/wesleytodd/setprototypeof |
| sharp | 0.35.5 | Apache-2.0 | Server | https://github.com/lovell/sharp |
| sonic-boom | 4.2.1 | MIT | Server | https://github.com/pinojs/sonic-boom |
| source-map | 0.6.1 | BSD-3-Clause | Server | http://github.com/mozilla/source-map |
| split2 | 4.2.0 | ISC | Server | https://github.com/mcollina/split2 |
| standardwebhooks | 1.1.1 | MIT | Server | https://github.com/standard-webhooks/standard-webhooks |
| statuses | 2.0.2 | MIT | Server | jshttp/statuses |
| string-width | 4.2.3 | MIT | Server | sindresorhus/string-width |
| strip-ansi | 6.0.1 | MIT | Server | chalk/strip-ansi |
| thread-stream | 4.2.0 | MIT | Server | https://github.com/mcollina/thread-stream |
| tiny-emitter | 2.1.0 | MIT | Server | https://github.com/scottcorgan/tiny-emitter |
| toad-cache | 3.7.4 | MIT | Server | https://github.com/kibertoad/toad-cache |
| toidentifier | 1.0.1 | MIT | Server | component/toidentifier |
| ts-algebra | 2.0.0 | MIT | Server | https://github.com/ThomasAribart/ts-algebra |
| tslib | 2.9.1 | 0BSD | Server | https://github.com/Microsoft/tslib |
| tslib | 1.14.1 | 0BSD | Server | https://github.com/Microsoft/tslib |
| tslib | 2.3.0 | 0BSD | Oberfläche | https://github.com/Microsoft/tslib |
| tsyringe | 4.10.0 | MIT | Server | https://github.com/Microsoft/tsyringe |
| uglify-js | 3.19.3 | BSD-2-Clause | Server | mishoo/UglifyJS |
| uuid | 14.0.3 | MIT | Server | https://github.com/uuidjs/uuid |
| which-module | 2.0.1 | ISC | Server | https://github.com/nexdrew/which-module |
| wordwrap | 1.0.0 | MIT | Server | git://github.com/substack/node-wordwrap |
| wrap-ansi | 6.2.0 | MIT | Server | chalk/wrap-ansi |
| xml2js | 0.6.2 | MIT | Server | https://github.com/Leonidas-from-XIV/node-xml2js |
| xmlbuilder | 11.0.1 | MIT | Server | git://github.com/oozcitak/xmlbuilder-js |
| y18n | 4.0.3 | ISC | Server | git@github.com:yargs/y18n |
| yargs | 15.4.1 | MIT | Server | https://github.com/yargs/yargs |
| yargs-parser | 18.1.3 | ISC | Server | https://github.com/yargs/yargs-parser |
| zod | 4.6.7 | MIT | Server | https://github.com/colinhacks/zod |
| zrender | 6.1.0 | BSD-3-Clause | Oberfläche | https://github.com/ecomfe/zrender |

Hinweis: `hyperformula` (GPL-3.0) wird von `@actual-app/api` mitgebracht. Deshalb steht TillSplit unter einer GPL-verträglichen Lizenz (AGPL-3.0).

## NOTICE-Dateien (Apache-2.0)

### es-toolkit

```
es-toolkit

Parts of the test suite and compatibility layer in es-toolkit/compat are
derived from Lodash (https://github.com/lodash/lodash).

Lodash copyright notice and MIT permission notice:

Copyright OpenJS Foundation and other contributors <https://openjsf.org/>

Based on Underscore.js, copyright Jeremy Ashkenas,
DocumentCloud and Investigative Reporters & Editors <http://underscorejs.org/>

This software consists of voluntary contributions made by many
individuals. For exact contribution history, see the revision history
available at https://github.com/lodash/lodash

The following license applies to all parts of this software except as
documented below:

====

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

### echarts

```
Apache ECharts
Copyright 2017-2026 The Apache Software Foundation

This product includes software developed at
The Apache Software Foundation (https://www.apache.org/).
```
