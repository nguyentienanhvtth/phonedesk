<p align="center">
  <img src="docs/brand/phonedesk-mark.svg" alt="PhoneDesk logo" width="112" height="112">
</p>

<h1 align="center">PhoneDesk</h1>

<p align="center"><b>Điện thoại cũ thành bảng điều khiển cho máy tính.</b></p>

<p align="center">
  <a href="https://github.com/nguyentienanhvtth/phonedesk/releases"><img alt="Release" src="https://img.shields.io/github/v/release/nguyentienanhvtth/phonedesk?color=22d3ee&label=release"></a>
  <a href="LICENSE"><img alt="MIT License" src="https://img.shields.io/badge/license-MIT-22d3ee"></a>
  <img alt="macOS and Windows" src="https://img.shields.io/badge/platform-macOS%20%C2%B7%20Windows-0b0d10">
</p>

> **Fork này** dựa trên [howznguyen/phonedesk](https://github.com/howznguyen/phonedesk) (MIT). Các bản cài đặt và cập nhật chỉ lấy từ repo này (nguyentienanhvtth/phonedesk), không tự động tải từ upstream.

<p align="center"><a href="README.md">English</a> · <b>Tiếng Việt</b></p>

Biến điện thoại hoặc máy tính bảng cũ thành bảng điều khiển kiểu Stream Deck và màn hình theo dõi cho Mac hoặc PC Windows. PhoneDesk
là một agent nhỏ chạy trên máy tính, phục vụ giao diện cảm ứng cho trình duyệt bất kỳ trong cùng mạng Wi-Fi. Không cần
cài app trên điện thoại, không cần tài khoản hay dịch vụ đám mây.

> **Trạng thái:** bản đầu (0.x). Hỗ trợ chính là macOS, Windows đang thử nghiệm. Binary chưa ký bằng Developer ID và chưa notarize: xem [Cài đặt](#cài-đặt).

<p align="center"><img src="docs/images/promo-hero.png" alt="PhoneDesk: điện thoại cũ thành bảng điều khiển cho máy tính"></p>

## Làm được gì

| Dùng cho | Trên điện thoại |
|---|---|
| **Phím tắt** | Mở app (kèm icon thật) và URL, tổ hợp phím, gõ chữ, lệnh shell, macro, phím media và âm lượng |
| **Theo dõi máy** | CPU, RAM, mạng, tải và thời gian chạy, chọn được kiểu biểu đồ; chạm CPU để xem danh sách tiến trình |
| **Lập trình với AI** | Quota và thời điểm reset của Claude, Codex, Antigravity; chọn được mốc muốn xem (5 giờ, 7 ngày, theo model); các phiên Claude Code / Codex trên máy |
| **Điều khiển Claude Code từ xa** | Trả lời **Cho phép / Từ chối** và các câu hỏi nhiều lựa chọn của Claude ngay trên điện thoại (bật khi cần) |
| **Hằng ngày** | Đang phát kèm ảnh bìa và nút phát tiếp, 6 kiểu đồng hồ và giờ thế giới, thời tiết (theo giờ, theo ngày, °C hoặc °F), soundboard, thông báo |
| **Home Assistant** | Đèn có màu, nhiệt độ màu, cảnh và hiệu ứng; điều hòa (chế độ, quạt, đảo gió), quạt, rèm, robot hút bụi, khóa và cảm biến (tùy chọn) |
| **Tự động hóa** | Webhook đẩy giá trị và thông báo, rule phản ứng theo hoạt động trên máy |
| **Tùy biến** | Lưới kéo thả (8×4, 8×3, 5×3…) có xem trước theo từng cỡ màn hình, 4 kiểu ô (Soft, Solid, Outline, iOS), màu riêng cho từng ô, hơn 5.000 icon, tiếng Anh hoặc tiếng Việt |

Layout là lưới ô vuông cố định, sắp xếp bằng kéo thả ở trang quản lý `http://localhost:7420/manage/`. Có MCP server để
trợ lý AI sắp xếp layout giúp bạn. Chạy trên macOS, và Windows 10/11 (thử nghiệm).

## Ảnh chụp

<p align="center"><img src="docs/images/demo.gif" alt="Một vòng 16 giây với dữ liệu mẫu: các trang, quota AI, phím, Home Assistant và câu hỏi của Claude Code." width="820"><br><sub>Một vòng 16 giây với dữ liệu mẫu: các trang, quota AI, phím, Home Assistant và câu hỏi của Claude Code.</sub></p>

<table>
<tr>
<td width="50%"><img src="docs/images/promo-claude.png" alt="Trả lời Claude Code trên điện thoại"></td>
<td width="50%"><img src="docs/images/promo-ai.png" alt="Quota và phiên AI"></td>
</tr>
<tr>
<td align="center"><b>Trả lời Claude Code trên điện thoại</b></td>
<td align="center"><b>Quota và phiên AI</b></td>
</tr>
<tr>
<td width="50%"><img src="docs/images/promo-keys.png" alt="Lưới phím kiểu Stream Deck"></td>
<td width="50%"><img src="docs/images/promo-home.png" alt="Home Assistant"></td>
</tr>
<tr>
<td align="center"><b>Lưới phím kiểu Stream Deck</b></td>
<td align="center"><b>Home Assistant</b></td>
</tr>
</table>

## Cài đặt

Bạn cần một **máy Mac** (macOS 13 trở lên) hoặc **PC Windows 10/11**, cùng một **điện thoại hoặc máy tính bảng dùng chung
Wi-Fi**. Không cần cài gì trên điện thoại. Mất khoảng 2 phút.

### 1. Cài trên máy tính

**Trên Mac**

1. Mở **Terminal**: bấm <kbd>⌘ Command</kbd> + <kbd>Space</kbd>, gõ `Terminal`, bấm <kbd>Return</kbd>.
2. Sao chép dòng dưới, dán vào Terminal, bấm <kbd>Return</kbd>:

```sh
curl -fsSL https://raw.githubusercontent.com/nguyentienanhvtth/phonedesk/main/setup.sh | bash
```

**Trên Windows**

1. Mở **PowerShell**: bấm **Start**, gõ `PowerShell`, bấm <kbd>Enter</kbd> (không cần quyền quản trị).
2. Sao chép dòng dưới, dán vào PowerShell, bấm <kbd>Enter</kbd>:

```powershell
irm https://raw.githubusercontent.com/nguyentienanhvtth/phonedesk/main/setup.ps1 | iex
```

Bạn sẽ thấy thanh tải, rồi vài dòng `OK`. Cuối cùng PhoneDesk in ra một **mã QR**, một **địa chỉ cho điện thoại**
(ví dụ `http://may-cua-ban.local:7420`) và một **mã PIN 6 số**. Để nguyên cửa sổ đó cho bước sau.

Từ giờ PhoneDesk tự chạy mỗi khi bạn đăng nhập, và lệnh `phonedesk` dùng được trong mọi cửa sổ terminal mới.

### 2. Mở trên điện thoại

- **Dễ nhất:** mở **Camera** của điện thoại, hướng vào mã QR trên máy tính, rồi chạm vào đường link hiện ra.
- **Hoặc** gõ địa chỉ vào trình duyệt của điện thoại rồi nhập mã PIN.

Điện thoại sẽ được nhớ, nên chỉ cần làm một lần. Muốn chạy toàn màn hình thì thêm ra màn hình chính:

- **iPhone (Safari):** bấm **Chia sẻ** → **Thêm vào MH chính**.
- **Android (Chrome):** bấm **⋮** → **Thêm vào màn hình chính**.

### 3. Tùy biến

Trên máy tính, mở **http://localhost:7420/manage/** trong trình duyệt. Kéo app, phím tắt và widget vào khung điện thoại,
rồi bấm **Save**. Điện thoại cập nhật ngay.

- **Cỡ màn hình:** chọn loại điện thoại (iPhone 5s/SE, iPhone, Pro Max, Android, iPad hoặc tự nhập) phía trên khung xem
  trước để thấy đúng những gì máy sẽ hiện. Khi ô quá nhỏ, khó bấm, trang sẽ cảnh báo.
- **Giao diện:** chế độ sáng tối, kiểu bo góc, kiểu ô, hướng màn hình và màu nhấn đều là thẻ có hình minh họa, nhìn là
  biết kết quả trước khi chọn.
- **Từng ô:** chọn màu, kiểu tô và kích thước (từ 1×1 tới 4×3) qua các hình xem trước nhỏ.

<table>
<tr><td colspan="2"><img src="docs/images/manage-screen-size.png" alt="Trang quản lý xem trước ở cỡ iPhone 5s, kèm ô chọn cỡ màn hình"></td></tr>
<tr>
<td width="50%"><img src="docs/images/manage-theme.png" alt="Tùy chọn giao diện dạng thẻ có hình"></td>
<td width="50%"><img src="docs/images/manage-tile.png" alt="Chọn kích thước và kiểu tô cho ô"></td>
</tr>
</table>

Lần đầu một phím gửi phím tắt, macOS sẽ hỏi quyền **Trợ năng (Accessibility)**: hãy cho phép (Cài đặt hệ thống → Quyền riêng
tư & Bảo mật → Trợ năng). Windows hỏi một lần cho PhoneDesk dùng mạng: hãy cho phép.

### Gặp trục trặc?

| Vấn đề | Cách xử lý |
|---|---|
| Điện thoại không mở được địa chỉ | Kiểm tra điện thoại và máy tính dùng **chung Wi-Fi**. Trên Windows, cho phép PhoneDesk khi tường lửa hỏi. Thử địa chỉ dạng số mà bộ cài in ra (`http://192.168…:7420`). |
| `could not reach GitHub` hoặc `error: 503` | GitHub trục trặc tạm thời. Chờ vài giây rồi chạy lại đúng dòng lệnh đó. |
| Tải chậm | File khoảng 20 MB (Windows 40 MB). Cứ để chạy, thanh tải cho thấy tiến độ. |
| `phonedesk: command not found` | Mở một cửa sổ terminal **mới**. |
| Bấm phím trên Mac không có tác dụng | Cho phép **Trợ năng** cho PhoneDesk, rồi chạy `phonedesk doctor` để xem còn thiếu gì. |
| Phím ngừng hoạt động sau khi cập nhật | macOS gắn quyền Trợ năng với từng bản build. Vào trang quản lý, tab **Permissions**, bấm **Đặt lại và hỏi lại** (hoặc chạy `phonedesk doctor --request accessibility --reset`) rồi bật phonedesk. |
| Điện thoại cũ không mở được địa chỉ `.local` | Dùng địa chỉ IP mà bộ cài in ra, và đặt IP cố định cho máy tính trong router để IP không đổi. |
| `port 7420 is in use` | Có chương trình khác đang dùng cổng đó. Chạy lại bộ cài với `--port 7421` (Mac: `… \| bash -s -- --port 7421`). |

### Cập nhật hoặc gỡ

- **Cập nhật:** chạy lại đúng dòng lệnh cài. Layout và điện thoại đã ghép đôi vẫn giữ nguyên.
- **Gỡ (Mac):** `curl -fsSL https://raw.githubusercontent.com/nguyentienanhvtth/phonedesk/main/uninstall.sh | bash`. Dữ liệu được giữ lại; thêm `-s -- --purge` sau `bash` để xóa luôn.
- **Gỡ (Windows):** `irm https://raw.githubusercontent.com/nguyentienanhvtth/phonedesk/main/uninstall.ps1 | iex`.

<details>
<summary>Tùy chọn khác và chi tiết bộ cài</summary>

- Bộ cài tải đúng file từ [bản phát hành mới nhất](https://github.com/nguyentienanhvtth/phonedesk/releases/latest), kiểm tra SHA-256
  với `SHA256SUMS` (sai là dừng), cài cho riêng người dùng của bạn (không cần `sudo` hay quyền quản trị), tự chạy khi đăng
  nhập (launchd trên macOS, Task Scheduler trên Windows) và thêm vào PATH.
- Tùy chọn trên Mac đặt sau `bash -s --`: `--yes` (không hỏi), `--version 0.1.1`, `--port 7421`, `--no-autostart`,
  `--no-open`, `--no-path`, `--dry-run`. Trên Windows đặt biến môi trường trước dòng lệnh, ví dụ
  `$env:PHONEDESK_PORT=7421; irm … | iex` (xem đầu file [setup.ps1](setup.ps1)).
- Vị trí file: chương trình ở `~/.phonedesk/bin/phonedesk` (macOS) và `%LOCALAPPDATA%\PhoneDesk\bin\phonedesk.exe` (Windows);
  dữ liệu ở `~/.phonedesk`; log ở `~/.phonedesk/logs`.
- Dịch vụ nền: `phonedesk service install|uninstall|status|restart`.
- Chữ ký: file thực thi chỉ ký ad-hoc, chưa có Apple Developer ID hay chứng chỉ Windows. Bộ cài đã xử lý chuyện này; nếu tự tải
  bằng trình duyệt thì trên macOS cần `xattr -d com.apple.quarantine <file>`, trên Windows chọn "More info → Run anyway".
- Lỗi đã biết trên Windows: phím gõ chữ có thể ra sai ký tự. Mở app, phím tắt, media và âm lượng vẫn chạy bình thường.

</details>

## Cài từ mã nguồn

Yêu cầu: macOS 13 trở lên (Apple silicon hoặc Intel), hoặc Windows 10/11 x64. Linux chưa được thử.

Từ mã nguồn (cần [Bun](https://bun.sh) 1.3+):

```sh
git clone https://github.com/nguyentienanhvtth/phonedesk && cd phonedesk
bun install
bun run build          # build web và dist/phonedesk
./dist/phonedesk       # in ra địa chỉ cho điện thoại và mã PIN ghép đôi
```

Mở địa chỉ đó trên điện thoại (cùng Wi-Fi), nhập PIN, rồi thêm trang vào màn hình chính để chạy toàn màn hình. Trang
quản lý ở `http://localhost:7420/manage/`. Ngôn ngữ đổi trong **Quản lý › Giao diện** (mặc định tiếng Anh).

Lần đầu một ô gửi phím tắt, macOS sẽ hỏi quyền **Trợ năng (Accessibility)**.

### Build trên Windows

Trên Windows 10/11, mở PowerShell và chạy:

```powershell
# Cài Bun (nếu chưa có)
irm bun.sh/install.ps1 | iex

# Clone và build
git clone https://github.com/nguyentienanhvtth/phonedesk
cd phonedesk
bun install
bun run build:win      # tạo dist/phonedesk-windows-x64.exe
.\dist\phonedesk-windows-x64.exe
```

**Build bằng GitHub Actions:**

Fork này có sẵn workflow `.github/workflows/build-windows.yml` để build tự động mỗi khi push code lên
nhánh `main`. File `.exe` sẽ nằm trong tab Actions > Artifacts.

**Về cập nhật tự động:**

Fork này **tắt mặc định** kiểm tra cập nhật tự động. Bạn không bao giờ tự động tải bản cập nhật từ upstream (howznguyen/phonedesk).
Nếu muốn bật kiểm tra cập nhật từ repo này, đặt `PHONEDESK_ENABLE_UPDATE_CHECK=1`.

## Tính năng mới cho Windows

### Widget GPU (NVIDIA)

Với máy có card NVIDIA (GeForce hoặc RTX), PhoneDesk có thể hiện:
- **Tải GPU** (0-100%)
- **Nhiệt độ**
- **VRAM** sử dụng / tổng
- **Công suất** (W)
- **Xung nhịp** GPU và bộ nhớ

Yêu cầu: `nvidia-smi.exe` trong PATH (có sẵn khi cài driver NVIDIA).

### Điều khiển âm thanh

- **Âm lượng loa** và **tắt tiếng** như các nền tảng khác
- **Tắt tiếng micro** (default capture device) - hữu ích khi chơi game hoặc họp online

### Layout Gaming PC

Có sẵn layout mẫu cho PC chơi game trong trang quản lý. Vào **Quản lý › Screens**, mở mục **Layout templates** ở panel bên trái, chọn **Gaming PC**:

- Nút mở nhanh CS2 (`steam://rungameid/730`), Steam, Discord, Spotify
- Điều khiển âm lượng và tắt tiếng micro (hotkey `Ctrl+Shift+M`)
- Widget GPU, CPU, RAM, Network
- 3 trang: Gaming, Stats, Keys với phím tắt thường dùng (Copy, Paste, Undo, Screenshot, Lock...)

Layout mẫu giữ nguyên theme của bạn khi áp dụng.

## Tích hợp Claude Code (tùy chọn)

Trong **Quản lý › AI** có hai công tắc riêng, cài hook vào `~/.claude/settings.json` (có backup trước):

- **Hỏi quyền**: hook `PermissionRequest` hiện Cho phép / Từ chối trên điện thoại.
- **Câu hỏi**: hook `PreToolUse` cho `AskUserQuestion` hiện các lựa chọn của Claude trên điện thoại và gửi lại câu trả
  lời. Có thể chỉ bật khi bạn rời bàn phím.

Nếu điện thoại không trả lời kịp, Claude Code hỏi trong terminal như bình thường. Với Codex, hook hỏi quyền được cài
vào `~/.codex/hooks.json`.

Quota chỉ đọc: PhoneDesk đọc phiên đăng nhập Claude Code đã lưu sẵn (không bao giờ làm mới), file session cục bộ của
Codex và server cục bộ của Antigravity. Mọi kết nối ra ngoài được liệt kê trong [PRIVACY.md](PRIVACY.md).

## Quyền macOS

macOS gắn mỗi quyền với chương trình đang xin quyền. Khi chạy dịch vụ nền đó là file `phonedesk`; khi chạy từ Terminal đó là ứng dụng Terminal. Chạy `phonedesk doctor` để xem quyền nào đã cấp (lệnh hỏi chính agent đang chạy, tự nó không hiện hộp thoại nào):

| Quyền | Dùng cho | Ở đâu |
|---|---|---|
| Trợ năng (Accessibility) | các ô gửi phím, gõ chữ và âm lượng | Quyền riêng tư & Bảo mật > Trợ năng |
| Tự động hóa: System Events, Music, Spotify | ô phím, Đang phát và phím media | Quyền riêng tư & Bảo mật > Tự động hóa |
| Keychain: Claude Code | hạn mức Claude (chỉ đọc) | macOS hỏi một lần: chọn Luôn cho phép |
| Mạng cục bộ | Home Assistant trong mạng nhà | Quyền riêng tư & Bảo mật > Mạng cục bộ |
| Tường lửa | điện thoại kết nối vào agent | Mạng > Tường lửa > Tùy chọn |

```bash
phonedesk doctor                          # ✓ / ✗ từng mục, kèm cách sửa
phonedesk doctor --open accessibility     # mở đúng mục trong Cài đặt
phonedesk doctor --request accessibility  # để macOS liệt kê phonedesk (hiện hộp thoại)
```

Bản cập nhật được ký ad-hoc nên macOS có thể hỏi lại sau mỗi lần cập nhật: xóa mục `phonedesk` cũ trong danh sách Quyền riêng tư rồi thêm lại. Việc này hết khi bản phát hành được ký bằng Developer ID.

**Trên Windows** `phonedesk doctor` kiểm tra các mục khác (cùng lệnh; `phonedesk doctor --open firewall` mở Windows Security):

| Mục | Vì sao quan trọng |
|---|---|
| Tường lửa | Windows chặn kết nối đến trừ khi có quy tắc cho `phonedesk.exe`; trình cài đặt đề nghị thêm một quy tắc chỉ cho mạng nội bộ (local subnet) (một lần UAC, `uninstall.ps1` sẽ xóa). Thủ công, bằng quyền quản trị: `netsh advfirewall firewall add rule name="PhoneDesk" dir=in action=allow program="<đường dẫn>\phonedesk.exe" profile=any remoteip=localsubnet` |
| Loại mạng | Wi-Fi hoặc Ethernet nên là mạng Private (Settings > Network & internet) |
| Phiên màn hình | Gửi phím, gõ chữ, Đang phát và âm lượng chỉ hoạt động khi PhoneDesk chạy trong phiên đã đăng nhập (tác vụ đã lên lịch làm đúng như vậy; phiên SSH hoặc Windows service thì không) |
| Trình hỗ trợ PowerShell | Đang phát, âm lượng, biểu tượng app và danh sách tiến trình dùng một trình hỗ trợ Windows PowerShell 5.1 nhỏ |
| SmartScreen | `phonedesk.exe` tải về mang dấu internet sẽ bị cảnh báo; trình cài đặt gỡ dấu này |

## Trợ lý AI sắp xếp layout (MCP)

PhoneDesk có sẵn MCP server, nên Claude Code (hoặc client MCP bất kỳ) sắp xếp được layout bằng lời: "thêm một trang công cụ lập trình", "đặt Spotify cạnh đồng hồ". MCP server nói chuyện với agent đang chạy, nên cần bật PhoneDesk trước.

Đăng ký một lần, với đường dẫn mà bộ cài đã dùng:

| Cài bằng | Lệnh |
|---|---|
| `setup.sh` (macOS) | `claude mcp add phonedesk -- ~/.phonedesk/bin/phonedesk mcp` |
| `setup.ps1` (Windows) | `claude mcp add phonedesk -- "%LOCALAPPDATA%\PhoneDesk\bin\phonedesk.exe" mcp` |
| Build từ mã nguồn | `claude mcp add phonedesk -- /đường/dẫn/đầy/đủ/dist/phonedesk mcp` |

Thêm `--port N` sau `mcp` nếu agent không chạy ở cổng 7420, và `--scope user` trước `phonedesk` để dùng được trong mọi project. Kiểm tra bằng `claude mcp list`.

Các tool: `get_layout`, `add_page`, `add_item`, `update_item`, `move_item`, `resize_item`, `remove_item`, `update_page`, `remove_page`, `set_theme`, `list_apps`, `list_widgets`, `search_icons`, `preview_changes`, `undo`. Mọi thay đổi đều qua cùng bước kiểm tra như trang quản lý và hoàn tác được. [Layout skill](docs/skills/phonedesk-layout/SKILL.md) mô tả schema cho trợ lý.

## Bảo mật

- Agent lắng nghe trong mạng LAN. Điện thoại phải ghép đôi bằng PIN 6 số; token thiết bị lưu trong cookie.
- API quản lý chỉ trả lời trên `localhost`, chặn request từ trang khác và DNS rebinding.
- Ô có thể chạy lệnh shell do bạn cấu hình. Chỉ ghép đôi thiết bị bạn tin tưởng.

## Ghi công

- Icon: [Tabler Icons](https://tabler.io/icons) (MIT) và [LobeHub Icons](https://github.com/lobehub/lobe-icons) (MIT).
- Component giao diện: [Knowns UI](https://ui.knowns.dev).
- Dữ liệu thời tiết: [Open-Meteo](https://open-meteo.com) (CC BY 4.0).

## Giấy phép

[MIT](LICENSE)
