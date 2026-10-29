# S3 upload benchmark results

Every run appends a new section below; nothing already written is ever rewritten.
Bucket: `246109051-workspace` · Endpoint: `http://10.13.5.27:9000` · Region: `us-east-1`

## Run 2026-10-29T11:02:04.655Z (33.2 GB over 14 uploads)

- **Endpoint:** `http://10.13.5.27:9000`
- **Bucket:** `246109051-workspace`
- **Region:** `us-east-1`
- **Sizes:** 1 MB, 10 MB, 100 MB, 500 MB, 1 GB, 5 GB, 10 GB
- **Attempts per size:** 2
- **Upload concurrency:** 4 parts in flight (multipart)
- **Delete objects after upload:** yes

| # | Size | Attempt | Duration (s) | Throughput (MB/s) | Status | Object key |
|--:|------|--------:|-------------:|------------------:|--------|------------|
| 1 | 1 MB | 1/2 | 3.204 | 0.33 | OK | `bench/2026-10-29T11-02-04-655Z/1mb-attempt1.bin` |
| 2 | 1 MB | 2/2 | 1.446 | 0.73 | OK | `bench/2026-10-29T11-02-04-655Z/1mb-attempt2.bin` |
| 3 | 10 MB | 1/2 | 15.395 | 0.68 | OK | `bench/2026-10-29T11-02-04-655Z/10mb-attempt1.bin` |
| 4 | 10 MB | 2/2 | 14.100 | 0.74 | OK | `bench/2026-10-29T11-02-04-655Z/10mb-attempt2.bin` |
| 5 | 100 MB | 1/2 | 125.673 | 0.83 | OK | `bench/2026-10-29T11-02-04-655Z/100mb-attempt1.bin` |
| 6 | 100 MB | 2/2 | 82.254 | 1.27 | OK | `bench/2026-10-29T11-02-04-655Z/100mb-attempt2.bin` |
| 7 | 500 MB | 1/2 | 289.990 | - | FAILED: connect ECONNABORTED 10.13.5.27:9000 | `bench/2026-10-29T11-02-04-655Z/500mb-attempt1.bin` |
| 8 | 500 MB | 2/2 | 0.079 | - | FAILED: connect ENETUNREACH 10.13.5.27:9000 | `bench/2026-10-29T11-02-04-655Z/500mb-attempt2.bin` |
| 9 | 1 GB | 1/2 | 0.402 | - | FAILED: connect ENETUNREACH 10.13.5.27:9000 | `bench/2026-10-29T11-02-04-655Z/1gb-attempt1.bin` |

**Summary:** 9 uploads · 6 ok · 3 failed · 8m 53s total · average 0.76 MB/s · objects deleted after upload (6) · finished 2026-10-29T11:10:57.698Z

