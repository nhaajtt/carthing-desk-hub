# Nhật ký phát triển: Car Thing Desk Hub

> Ghi lại toàn bộ quá trình biến một chiếc Spotify Car Thing đã "chết" thành màn hình để bàn: từ lúc lên ý tưởng, chọn hướng đi, thiết kế hệ thống, cho tới từng lỗi gặp phải và cách mình gỡ. Viết theo thứ tự thời gian, kèm số liệu đo thật trên thiết bị.
>
> Toàn bộ dự án làm trong hai ngày 16–17/10/2026.

## Mục lục

0. [Bối cảnh: Car Thing là gì và tại sao lại "chết"](#0-bối-cảnh)
1. [Lên ý tưởng: DeskThing, Nocturne hay tự làm?](#1-lên-ý-tưởng)
2. [Lần đầu chạm vào thiết bị: Nocturne v3](#2-lần-đầu-chạm-vào-thiết-bị-nocturne-v3)
3. [Nâng cấp lên Nocturne v4](#3-nâng-cấp-lên-nocturne-v4)
4. [Dùng trên xe hay để bàn? Câu hỏi CarPlay](#4-dùng-trên-xe-hay-để-bàn)
5. [Chọn "bộ não": Pi, laptop hay server có sẵn](#5-chọn-bộ-não)
6. [Thiết kế mạng và bảo mật: nguyên tắc "không tin mặc định"](#6-thiết-kế-mạng-và-bảo-mật)
7. [Hub v1: chọn nguồn dữ liệu miễn phí](#7-hub-v1-chọn-nguồn-dữ-liệu)
8. [Đưa hub lên Car Thing](#8-đưa-hub-lên-car-thing)
9. [Điều khiển: núm xoay, nút, back](#9-điều-khiển)
10. [Độ sáng màn hình: cuộc chiến với cảm biến ánh sáng](#10-độ-sáng-màn-hình)
11. [Khởi động lại là mất hết: `nocturne-floor-sync`](#11-khởi-động-lại-là-mất-hết)
12. [Khoá SSH, NTP và `ip_nonlocal_bind`](#12-khoá-ssh-ntp-và-ip_nonlocal_bind)
13. [Server stats, trạng thái container, cảnh báo giá](#13-server-stats-container-cảnh-báo-giá)
14. [Mei: trợ lý giọng nói, và micro "câm"](#14-mei-trợ-lý-giọng-nói)
15. [Spotify](#15-spotify)
16. [Thiết kế lại giao diện: "Mei's Night Market"](#16-thiết-kế-lại-giao-diện)
17. [Hiệu năng: từ 18 FPS lên 60 FPS](#17-hiệu-năng)
18. [Mei & Nhat: sân khấu nhỏ](#18-mei--nhat)
19. [News: 10 chủ đề và tóm tắt bài báo](#19-news)
20. [Chế độ dọc, menu nổi, 4 nút theo trang](#20-chế-độ-dọc-menu-nổi-4-nút-theo-trang)
21. [Màn hình tự tắt, và đợt nâng cấp thứ hai](#21-màn-hình-tự-tắt-và-đợt-nâng-cấp-thứ-hai)
22. [Đợt nâng cấp thứ ba: ban đêm, bảo mật, cập nhật](#22-đợt-nâng-cấp-thứ-ba-ban-đêm-bảo-mật-cập-nhật)
23. [Bảng tổng hợp lỗi](#23-bảng-tổng-hợp-lỗi)
24. [Những điều rút ra](#24-những-điều-rút-ra)

---

## 0. Bối cảnh

**Spotify Car Thing** là một màn hình nhỏ gắn trên xe, ra mắt năm 2022. Ngày **9/12/2024**, Spotify ngừng hỗ trợ và thiết bị trở thành cục chặn giấy. Phần cứng thì vẫn còn rất "ngon" để vọc:

| Thành phần | Thông số |
|---|---|
| SoC | Amlogic S905D2, 4 nhân Cortex-A53 |
| RAM / bộ nhớ | 512 MB / eMMC 4 GB |
| Màn hình | 4", 800 × 480, cảm ứng |
| Điều khiển | 1 núm xoay có nhấn, 4 nút preset, 1 nút back, 1 nút tròn (cài đặt) |
| Âm thanh | 4 micro, **không có loa** |
| Kết nối | Bluetooth, USB-C. **Không có Wi-Fi** |

Hai đặc điểm quyết định gần như mọi thiết kế phía sau: **không có Wi-Fi** và **RAM rất ít**.

## 1. Lên ý tưởng

Có 3 hướng mình cân nhắc:

| Hướng | Ưu | Nhược |
|---|---|---|
| **Nocturne**: firmware cộng đồng, biến Car Thing thành remote Spotify như cũ | Đẹp, còn được phát triển | Chỉ là Spotify; app điện thoại phải trả phí; phải tin một app bên thứ ba |
| **DeskThing**: biến Car Thing thành màn hình phụ của PC, có hệ thống app | Có SDK | Phải cắm vào PC và chạy phần mềm trên PC |
| **Tự làm**: một hub riêng | Tự do hoàn toàn; gom được mọi thứ mình cần | Tự lo hết |

Mình muốn gom **càng nhiều thứ càng tốt** vào một màn hình: giá coin và vàng, tỷ giá, tin tức, thời tiết, tình trạng server, nhạc. Mình cũng **không muốn chạy gì trên PC chính**, vì PC cần được cách ly. Vì vậy DeskThing bị loại.

**Quyết định:** giữ **Nocturne làm hệ điều hành** (vì nó đã giải quyết phần khó nhất: Linux chạy được trên con chip này, có driver màn hình và nút, có trình duyệt kiosk), và **thay trang mà trình duyệt hiển thị** bằng hub tự viết.

Ưu tiên số 1 mình đặt ra từ đầu: **giá coin, vàng, tỷ giá (thị trường) phải ở trang đầu và cập nhật sớm nhất có thể.** Mọi API phải **miễn phí**; cái gì tốn tiền thì phải hỏi trước.

## 2. Lần đầu chạm vào thiết bị: Nocturne v3

Car Thing đã được flash Nocturne từ trước. Cắm vào máy tính, Windows nhận nó thành một **card mạng USB (RNDIS)**, nhưng chỉ tự gán IP `169.254.x` (APIPA), tức là không ai cấp IP.

**Tìm thiết bị khi chưa có IP:** ping địa chỉ multicast IPv6 `ff02::1` trên đúng card đó, rồi đọc bảng neighbor. Car Thing hiện ra với địa chỉ link-local `fe80::…`. Quét port thì thấy **22 (SSH, OpenSSH 10.0)**. Mật khẩu root mặc định của Nocturne là `nocturne` (công khai trong README của dự án).

Vào được bên trong mới thấy:

* Nocturne **v3.0.0** chạy trên **Void Linux**, kernel **4.9** (2018).
* Trình duyệt là **Chromium 69** (2018), chạy kiosk ở `localhost:80`, có bật sẵn remote debugging.
* Phân vùng hệ thống được mount **chỉ-đọc** (`/dev/system_a` ro), còn `/var` thì ghi được.

### Lỗi #1: DHCP của Nocturne crash liên tục

`dnsmasq` (server DHCP cấp IP cho máy tính qua USB) cứ chạy rồi chết, chạy rồi chết. Chạy tay thì thấy:

```
dnsmasq: failed to set SO_BINDTODEVICE on DHCP socket: Protocol not available
```

**Nguyên nhân:** cấu hình có `bind-interfaces`. Với tuỳ chọn này, dnsmasq gọi `SO_BINDTODEVICE`, mà kernel 4.9 của Car Thing không hỗ trợ.

**Cách sửa:** viết một cấu hình riêng trong `/var` (ghi được), bỏ `bind-interfaces`, và **cố ý không đẩy gateway hay DNS** xuống máy tính, để Internet của máy tính không bị ảnh hưởng. Sau đó máy tính nhận `172.16.42.1`, Car Thing là `172.16.42.2`. Bản sửa này chỉ sống tới lần khởi động lại, vì danh sách service nằm trên phân vùng chỉ-đọc.

**Kết luận:** v3 quá cũ. Chromium 69 không chạy được JavaScript hiện đại, và hệ thống thì có lỗi. Phải lên v4.

## 3. Nâng cấp lên Nocturne v4

Nocturne v4 đã viết lại hoàn toàn trên **Yocto**. UI của nó dùng React 19, tức là chắc chắn có Chromium mới. Mình flash bằng `flashthing-cli`. Car Thing vào **chế độ flash** khi giữ **nút preset 1 và 4** trong lúc cắm USB (máy tính thấy `GX-CHIP`, USB ID `1b8e:c003`).

### Lỗi #2: flash thất bại với "USB error: Operation timed out"

```
erasing 2793472 sectors at LBA 0 before sparse write
ERROR flashthing_cli: failed to flash device: USB error: Operation timed out
```

**Nguyên nhân:** bước **xoá 1,4 GB** trên eMMC chạy lâu hơn thời gian chờ USB (khoảng 10 giây) của công cụ. Hai phân vùng boot đã ghi xong, chỉ có phần hệ thống là chưa.

**Cách sửa:** thiết bị vẫn ở chế độ flash nên không bị hỏng. **Chạy lại đúng lệnh đó**: lần hai, việc xoá đã xong ở phía chip, nên ghi 1,4 GB chỉ mất 159 giây. Bài học: khi một thao tác phần cứng bị timeout ở phía máy tính, thao tác đó thường **vẫn tiếp tục chạy ở phía thiết bị**.

Sau khi flash xong:

| | v3 | v4 |
|---|---|---|
| Hệ điều hành | Void Linux | Yocto |
| Kernel | 4.9 | **7.0.2** |
| Chromium | 69 | **147** (bản `cast_shell` nhẹ hơn) |
| USB | RNDIS, DHCP lỗi | CDC-NCM, DHCP chạy ngay (`10.42.1.x`) |

## 4. Dùng trên xe hay để bàn?

Câu hỏi thật thà: **xe đã có CarPlay thì Car Thing còn tác dụng gì?** CarPlay đã có bản đồ, nhạc, cuộc gọi, Siri. Car Thing chỉ hơn ở **núm xoay vật lý** và **nút preset**.

Mình cũng đã tính chuyện tự làm "app điện thoại" để khỏi phải tin app của Nocturne (iPhone có sẵn AVRCP để điều khiển nhạc qua Bluetooth, và ANCS để nhận thông báo). Nhưng:

* Kernel của Nocturne v4 **tắt `CONFIG_BT_BNEP`**, nên không chia sẻ Internet qua Bluetooth được nếu không build lại kernel.
* iPhone kết nối CarPlay vẫn nối thêm được thiết bị Bluetooth khác, nhưng các tính năng thêm này rủi ro mà lợi ích lại thấp.

**Quyết định:** Car Thing là **màn hình để bàn**. Trên xe thì dùng CarPlay.

## 5. Chọn "bộ não"

Car Thing **không có Wi-Fi**, nên luôn phải **cắm USB vào một máy ở ngay cạnh nó**. Máy đó vừa là cổng mạng, vừa là "bộ não" chạy toàn bộ logic.

| Ứng viên | Đánh giá |
|---|---|
| Pi 3B (RAM 1 GB, thẻ nhớ) | Đủ để làm proxy API. Yếu nếu sau này muốn chạy AI ngay trên máy; thẻ nhớ chạy 24/7 dễ hỏng |
| Laptop cũ | RAM nhiều, SSD, **pin đóng vai UPS**, có sẵn màn hình để sửa lỗi |
| Server 1 (mini PC) | Mạnh, nhưng **đang chạy nhiều dịch vụ quan trọng khác**. Không muốn đặt một thiết bị "không đáng tin" cạnh chúng |
| **Server 2 (laptop Lenovo, i5-8250U, 8 luồng, 7 GB RAM)** | Gần như rảnh (chỉ có controller mạng), có pin. **→ Chọn** |

Lý do loại server 1 là một nguyên tắc sẽ lặp lại suốt dự án: **một thiết bị có mật khẩu root ai cũng biết, chạy trình duyệt, và mang ra mang vào thì phải được coi là không đáng tin.** Không đặt nó cạnh những thứ quan trọng.

## 6. Thiết kế mạng và bảo mật

### Nguyên tắc: không tin mặc định (zero trust)

* Mọi thiết bị, container, service đều **không đáng tin cho tới khi chứng minh được điều ngược lại**, kể cả khi nằm trong mạng nhà.
* **Quyền tối thiểu:** mỗi thứ chỉ được đúng phần nó cần.
* **Không mở port nào ra Internet.** Mọi API đều là kết nối đi ra.

### Tại sao Car Thing "đáng sợ"?

Không phải vì Nocturne xấu. Mình đã thấy tận mắt trên thiết bị:

1. Mật khẩu root là `nocturne`, công khai, và SSH đang bật.
2. Chromium chạy với cờ **`--no-sandbox`**: một lỗi của trình duyệt là đủ để có root.
3. Hub sẽ hiển thị nội dung từ Internet (tiêu đề tin, lyrics, ảnh bìa album).
4. Đây là thiết bị di động, có thể mất hoặc bị người khác cắm vào.

### Thiết kế

```
Car Thing ──USB (10.42.1.0/29)── Server 2 ──LAN── OPNsense ── Internet
 10.42.1.2                      10.42.1.6
 chỉ thấy :8787 (hub)           hub giữ toàn bộ API key
 và NTP                         không mở port ra Internet
```

* **Firewall phải đặt trên server 2, không phải trên router.** Lưu lượng giữa Car Thing và server 2 đi qua sợi cáp USB, không bao giờ đi qua router.
* **Bẫy Docker và UFW:** port mà Docker publish **không đi qua chain INPUT của UFW**, nên chặn bằng UFW là vô tác dụng. Luật cho cổng USB phải nằm trong chain **`DOCKER-USER`**, là chain Docker để dành cho người dùng (xem `host/ufw-after.rules.snippet`).
* **Bẫy "weak host model":** mình từng nghĩ bind dịch vụ vào `10.10.10.20` là Car Thing không với tới. **Sai.** Linux nhận gói gửi tới *bất kỳ* IP nào của máy, bất kể gói đi vào từ card nào. Car Thing đứng sau cổng USB vẫn gọi được `10.10.10.20`. Chỉ có firewall theo từng interface mới chặn được.
* **Không nhận gì từ Car Thing:** netplan cố định IP `10.42.1.6`, **không nhận route, DNS hay IPv6** từ thiết bị (`host/60-carthing.yaml`).

Kiểm tra từ chính Car Thing: SSH, UI quản lý mạng, Portainer, router và server 1 **đều bị chặn**. Từ LAN, các dịch vụ quản trị vẫn vào được bình thường.

Trong lúc rà soát, mình dọn luôn vài chỗ trong homelab theo cùng nguyên tắc:
* Đưa các trang quản trị về bind đúng địa chỉ cần thiết.
* Gỡ một công cụ giám sát chưa được cấu hình. Nó còn **trang tạo tài khoản admin không cần xác thực**, nghĩa là ai trong LAN mở trang đó trước sẽ thành admin.
* Đặt ACL cho node VPN có mở dịch vụ ra Internet, để node đó không với tới được các máy khác.

## 7. Hub v1: chọn nguồn dữ liệu

**Kiến trúc hub:** một tiến trình **Node 22 không có dependency nào**. Hub gom dữ liệu, giữ trạng thái, đẩy xuống màn hình bằng **Server-Sent Events**, và phục vụ luôn file UI tĩnh.

* *Tại sao SSE mà không phải WebSocket?* Dữ liệu chỉ đi một chiều (server → màn hình). SSE có sẵn trong trình duyệt và tự kết nối lại.
* *Tại sao không có dependency?* Container chạy chỉ-đọc, ít thứ phải cập nhật, ít bề mặt tấn công.

| Dữ liệu | Thử | Kết quả |
|---|---|---|
| Crypto real-time | Binance | ❌ **HTTP 451**, "restricted location" (mạng ra Internet bằng IP Mỹ) |
| | Bybit | ❌ HTTP 403 (CloudFront chặn theo quốc gia) |
| | **OKX WebSocket** | ✅ miễn phí, không cần key. Có REST làm dự phòng |
| Vàng thế giới | gold-api.com | ✅ |
| Vàng Việt Nam | BTMC | ❌ không phản hồi |
| | **PNJ** | ✅ (đơn vị là 10.000 đ/lượng) |
| Tỷ giá | **Vietcombank XML** | ✅ (giới hạn 1 request mỗi 5 phút) |
| Chỉ số | **Yahoo Finance** | ✅ (sau 2 lần sửa, xem bên dưới) |
| Thời tiết, AQI | **Open-Meteo** | ✅ |

### Lỗi #3: `getaddrinfo ENOTFOUND api.gold-api.com` chỉ trong container

Từ máy host thì phân giải tên miền được, nhưng trong container thì không. `nslookup` trong container cho thấy bản ghi A có, còn bản ghi AAAA trả về NXDOMAIN.

**Nguyên nhân:** image `node:22-alpine` dùng **musl libc**. Khi một trong hai truy vấn (A hoặc AAAA) trả về NXDOMAIN, `getaddrinfo` của musl coi như **cả tên miền không tồn tại**.

**Cách sửa:** đổi sang `node:22-bookworm-slim` (glibc).

### Lỗi #4: Yahoo trả HTTP 429

**Hai nguyên nhân chồng lên nhau:**
1. Gửi 8 request song song mỗi phút.
2. Bất ngờ hơn: Yahoo **chặn theo User-Agent**. `Mozilla/5.0` thì qua, nhưng chuỗi User-Agent đầy đủ của Chrome hoặc `curl/…` thì bị 429.

**Cách sửa:** dùng endpoint `v8/finance/spark` (**một request cho mọi mã**) và User-Agent ngắn `Mozilla/5.0`.

## 8. Đưa hub lên Car Thing

### Chọn cách trỏ kiosk

Script khởi động kiosk của Nocturne (`chromium-kiosk-launch`) đọc biến `KIOSK_ENV_OVERRIDE_FILE`. Mặc định biến này trỏ tới `/opt/nocturne/kiosk-env`, một file **nằm trên phân vùng ghi được**. Đặt `KIOSK_URL=http://10.42.1.6:8787/` vào đó là xong, không cần sửa hệ thống. (Về sau hoá ra cách này có bẫy, xem mục 11.)

### Lỗi #5: đồng hồ hiện 09:46 thay vì 18:46

Car Thing không có Internet nên không có NTP. Giờ hệ thống của nó **lệch hơn một tháng** (đang là 11/9).

**Cách sửa:** mỗi tin nhắn SSE kèm giờ của server, UI tính `clockOffset` rồi dùng giờ đó cho đồng hồ **và cho cả việc đánh dấu dữ liệu cũ**. Trước khi sửa, so sánh "cũ hay mới" bằng giờ sai của Car Thing nên luôn ra kết quả sai. (Sau này còn thêm NTP thật, xem mục 12.)

### Lỗi #6: chữ tràn trên thiết bị thật nhưng trên PC thì đẹp

Car Thing có font **Inter** thật. PC thì không có, nên trình duyệt PC dùng font thay thế hẹp hơn. Trên thiết bị, cột chỉ số bị tràn ("-2,14%" bị cắt mất).

**Bài học:** **luôn chụp màn hình trên thiết bị thật.** Mình viết `tools/cdp.mjs`: mở SSH tunnel tới cổng DevTools của Chromium (`9223`, chỉ nghe trên loopback), rồi chụp màn hình và chạy JavaScript từ xa.

## 9. Điều khiển

Mình dùng code UI của Nocturne làm "bản đồ" phím: núm xoay gửi sự kiện `wheel`, nhấn núm gửi `Enter`, nút back gửi `Escape`, 4 nút preset gửi `1`–`4`. Đọc device tree thì biết nút tròn thứ 5 là `button-mute` (keycode 50), tức là phím **`m`**.

Thiết kế điều khiển đổi qua vài vòng:

1. **v1:** nút 1–4 nhảy trang, back về trang chủ. **Vấn đề:** ở trang Focus, núm xoay vừa phải chuyển trang vừa phải chỉnh số phút, nên một khi xoay tới Focus là "kẹt" luôn ở đó.
2. **v2:** **núm luôn chuyển trang**. Back bật hoặc tắt "chế độ chỉnh", và chỉ trong chế độ đó núm mới chỉnh giá trị.
3. **v3 (bản hiện tại):** **nhấn núm = Enter** (vào một chế độ), **Back = thoát**. Back không bao giờ dùng để *vào* chế độ nữa, vì dùng Back để vào chế độ thì ngược trực giác. **4 nút preset làm việc riêng của từng trang**, có số nhỏ trên màn hình để biết nút nào làm gì.

## 10. Độ sáng màn hình

Màn hình rất tối: `/sys/class/backlight/backlight/brightness` chỉ là **21/160** (khoảng 13%). Ghi tay lên 128 thì vài giây sau tự quay về 21.

**Nguyên nhân:** daemon `nocturned` đọc `/var/lib/brightness.json` (`{"auto":true,…}`). Ở chế độ tự động, nó đọc cảm biến ánh sáng và liên tục ghi đè độ sáng.

**Cách sửa:** một script nhỏ trên Car Thing (`carthing/brightness-sync.sh`) hỏi hub mức độ sáng mong muốn, rồi làm 3 việc:
1. Ghi `{"auto":false,"brightness":N}` vào file cấu hình của Nocturne.
2. Khởi động lại `nocturned` để nó nạp giá trị mới.
3. Ghi vào sysfs.

Chỉ chính Car Thing được đổi độ sáng (hub kiểm tra IP nguồn). Thử từ LAN thì bị 403.

### Lỗi #7: lệnh `kill $(pgrep -f brightness-sync.sh)` tự giết luôn phiên SSH

`pgrep -f` khớp với **toàn bộ dòng lệnh**, mà chuỗi lệnh gửi qua SSH cũng chứa chữ "brightness-sync.sh". Bài học: kill qua file PID, đừng kill qua pattern có xuất hiện ngay trong chính lệnh đang chạy.

## 11. Khởi động lại là mất hết

Một ngày Car Thing khởi động lại (không rõ lý do), và màn hình hiện lại mã QR của Nocturne. File `/opt/nocturne/kiosk-env` **đã biến mất**.

**Nguyên nhân:** service **`nocturne-floor-sync`** khôi phục `/opt/nocturne` về bản gốc **mỗi lần khởi động**. Trước đó Car Thing chưa khởi động lại lần nào nên mình không phát hiện ra.

**Cách sửa:**
* Chuyển file cấu hình kiosk và các script sang **`/var/lib/hub/`**, nằm trên phân vùng dữ liệu, không bị khôi phục.
* Sửa **đúng một dòng** trong `/etc/default/chromium-kiosk` (`KIOSK_ENV_OVERRIDE_FILE=/var/lib/hub/kiosk-env`). Việc này cần mở khoá ghi phân vùng hệ thống, nên mình làm trong một phiên ngắn: `remount,rw` → sửa → `sync` → `remount,ro`, và giữ bản gốc ở `.orig`.

## 12. Khoá SSH, NTP và `ip_nonlocal_bind`

* **SSH:** chỉ cho phép key của server 2 (`carthing/10-hardening.conf`). Cấu hình được kiểm tra bằng `sshd -t` trước khi áp dụng, và tự hoàn tác nếu lỗi. Đã kiểm tra: đăng nhập bằng key vào được, bằng mật khẩu thì bị `Permission denied (publickey)`.
* **NTP:** chrony trên server 2 chỉ phục vụ subnet USB, UFW chỉ mở UDP 123 trên cổng USB. Car Thing chuyển sang dùng `systemd-timesyncd` (trước đó bị mask). Lần đồng bộ đầu tiên, giờ nhảy **+1 tháng 5 ngày 22 giờ 32 phút**.
* **`ip_nonlocal_bind`:** hub publish port trên `10.42.1.6`, mà địa chỉ này **chỉ tồn tại khi Car Thing đang cắm**. Nếu server 2 khởi động lúc chưa cắm, Docker báo `cannot assign requested address` và hub không chạy. Bật `net.ipv4.ip_nonlocal_bind=1` thì Docker gắn được vào địa chỉ chưa xuất hiện. Đã thử bằng một container tạm: trước khi sửa thì lỗi, sau khi sửa thì chạy.

## 13. Server stats, container, cảnh báo giá

* **Server 1 tự đẩy số liệu sang hub** (`agent/`), **không mở port nào**. Hub chỉ nhận khi **đúng IP nguồn và đúng token** (so sánh bằng `timingSafeEqual`). Đã thử giả mạo từ PC: bị 403.
* **Trạng thái container:** mỗi server có một container `docker-status` nhỏ. Đây là thứ duy nhất được gắn `docker.sock`, và nó chỉ trả về tên và trạng thái. Hub và agent **không bao giờ cầm socket Docker**, vì cầm socket Docker gần như là cầm quyền root của máy.
* **Cảnh báo giá:** hub lấy mẫu giá mỗi phút, giữ 26 giờ lịch sử. Có hai loại luật: biến động ±X% trong 15 phút / 1 giờ / 4 giờ / 24 giờ, và vượt mốc giá. Mỗi luật có thời gian chờ 60 phút để không báo dồn dập. Luật nằm trong `config.json`.

## 14. Mei: trợ lý giọng nói

**Chọn AI:** phải miễn phí, nên dùng **Gemini API** (gói miễn phí của Google AI Studio). Gemini nhận **file âm thanh trực tiếp**, nên chỉ một lần gọi là vừa nhận dạng giọng nói vừa trả lời, không cần dịch vụ chuyển giọng nói thành chữ riêng. Hub gửi kèm "dữ liệu dashboard" (giá, thời tiết, server, tin tức), nên Mei trả lời được những câu như "giá vàng hôm nay thế nào".

**Luồng xử lý:** UI → hub → script trên Car Thing (long-poll để nhận lệnh) → `arecord` → upload file → hub chuyển đổi âm thanh → Gemini → bong bóng thoại. **API key chỉ nằm trên hub.**

### Lỗi #8: script nhập key "không nhận" key

Lệnh `ssh -t … 'read -rsp "…" k; …'` chạy trong PowerShell làm **hỏng dấu nháy lồng nhau**, và `.env` chỉ nhận được **1 ký tự**. Bản thứ hai thì không hiện gì khi dán (`read -s`), nên người dùng tưởng dán không được.

**Cách sửa:** đặt script sẵn trên server (`tools/set-gemini-key.sh`):
* Hiện `*` cho mỗi ký tự.
* Tắt chế độ bracketed paste.
* Chỉ bỏ khoảng trắng, giữ mọi ký tự khác.
* **Kiểm tra key với Google trước khi lưu**, và in ra lý do nếu Google từ chối.

### Lỗi #9: Mei trả lời câu hỏi mà mình chưa hỏi

Nhấn núm rồi không nói gì, Mei vẫn "trả lời" về thời tiết và giá vàng.

**Điều tra:**
* `hw:0,1` (kênh đang dùng để thu): đỉnh **26 / 32768**. Kênh này **câm**: nó là kênh loopback, không phải micro.
* 4 micro thật nằm ở **`hw:0,0`** (S32_LE, 4 kênh, 48 kHz), và đang bị **`nocturned` giữ** để nghe wake word "Hey Nocturne".
* Gemini nhận một file im lặng kèm dữ liệu dashboard, rồi **tự bịa ra câu hỏi**.

**Cách sửa (qua 3 vòng):**
1. Khi thu âm: tạm dừng `nocturned`, thu từ `hw:0,0`, xong thì bật lại. Hub gộp 4 kênh thành 1, hạ xuống 16 kHz, rồi chuẩn hoá âm lượng.
2. Lần thử thật của người dùng vẫn báo "không nghe thấy" (đỉnh 293–502). Khi **trừ độ lệch DC** thì mới thấy rõ: phòng yên tĩnh chỉ có mức nhiễu khoảng **4**, tức là con số 300–500 trước đó chủ yếu là DC. Micro này **cực nhỏ tiếng**, và chip **không có gain phần cứng** (`amixer` chỉ có 2 control định tuyến). Ngưỡng 1200 cao gấp hàng chục lần giọng nói thật. Đổi sang phát hiện giọng nói **tương đối**: các cửa sổ 50 ms to nhất phải lớn gấp **4 lần** nhiễu nền, tối thiểu RMS 20. Khuếch đại số tối đa 40 lần.
3. Micro mất khoảng 1 giây để mở (do dừng `nocturned`), nhưng màn hình đã báo "Listening" ngay, nên câu nói đầu bị mất. Thêm trạng thái **"getting ready"**: chỉ khi script báo `arecord` đã chạy thì mới chuyển sang "Listening".

Thêm vào đó: thu ở **16 kHz** thay vì 48 kHz (chip hỗ trợ S32_LE 4 kênh ở 16 kHz), nên file nhỏ hơn 3 lần, và file tới hub khoảng **2,8 giây** sau khi bấm dừng. Lần hỏi thật đầu tiên: *"Tìm cho tôi một GitHub repo hay hôm nay."* Mei nghe đúng và trả lời bằng tiếng Việt.

### Google Search cho Mei: không miễn phí nữa

Mình muốn Mei trả lời được "tin hot hôm nay", nên đã thử bật tính năng **grounding với Google Search**:
* `gemini-2.5-flash` và `2.5-flash-lite` (hai model có 500 lượt tìm kiếm miễn phí mỗi ngày): **"no longer available to new users"**.
* Các model mới: **429** khi bật tìm kiếm, vì gói miễn phí không có hạn mức tìm kiếm.

**Quyết định:** không trả tiền. Thay vào đó, đưa **tiêu đề tin mới nhất** (mục 19) vào ngữ cảnh của Mei, và dặn Mei **nói thật là không tra web được** thay vì đoán. Tính năng tìm kiếm vẫn có sẵn sau cờ `GEMINI_SEARCH=1`, nếu sau này bật gói trả phí.

## 15. Spotify

* Dùng **Authorization Code + PKCE**: không có client secret nào phải lưu. Refresh token lưu với quyền `600`.
* Redirect URI bắt buộc phải là HTTPS hoặc loopback (`http://127.0.0.1:8888/callback`). Hub không phải loopback của trình duyệt, nên mình mở **SSH tunnel tạm** từ máy tính: `127.0.0.1:8888 → hub`. Liên kết xong thì đóng tunnel. Bước liên kết được chống giả mạo bằng tham số `state` dùng một lần, hết hạn sau 10 phút.
* Lệnh điều khiển (play, next, volume, like) **chỉ nhận từ Car Thing**. Ảnh bìa đi qua hub (vì Car Thing không có Internet), và chỉ cho phép host `i.scdn.co`.
* Có một chuyện không thuộc về kỹ thuật: lúc đầu app Spotify đang đăng nhập bằng tài khoản Premium của người khác. Moi token từ app ra là được về mặt kỹ thuật, nhưng đó là truy cập tài khoản người khác khi họ không cho phép. **Không làm.** Sau này dùng tài khoản của chính mình.
* **Lỗi #10:** nút ⏮ ▶ ⏭ hiện thành ô màu cam. Car Thing hiển thị chúng bằng **font emoji màu**. Đổi sang icon SVG vẽ riêng.
* Thêm: nếu chưa có thiết bị nào đang phát mà bấm Play, hub tự gọi `/me/player/devices` rồi chuyển phát sang thiết bị Spotify đang mở.

## 16. Thiết kế lại giao diện

Bản v1 là "dashboard tối với một màu nhấn", kiểu ai cũng làm. Bản v2 có cá tính riêng: **"Mei's Night Market"**, chợ đêm của Mei.

* **Màu:** trời đêm tím chàm `#14112E`, vàng mít `#FFC23D` (màu của Mei), **xanh ngọc** `#3EE6A8` cho tăng, **hồng sen** `#FF6F9C` cho giảm.
* **Chữ:** **Bricolage Grotesque** cho tiêu đề và số lớn, Inter cho số liệu. Car Thing không có Internet nên hub tự phục vụ font (khoảng 75 KB, có subset tiếng Việt, giấy phép OFL).
* **Chuyển động:** bầu trời cực quang đổi màu theo thời tiết thật (có mưa thì có vệt mưa), giá BTC **lăn từng chữ số**, viên chỉ báo tab trượt theo trang, trang lướt và nghiêng vào theo chiều xoay núm.

Có những thứ đã thêm vào rồi lại bỏ theo phản hồi: mèo chạy ngang mỗi lần chuyển trang (rối mắt), mèo thò đầu ở góc mọi trang, vệt sáng quét qua ô BTC (tốn hiệu năng).

## 17. Hiệu năng

Đo bằng cách đếm `requestAnimationFrame` trong 3–5 giây, ngay trên Car Thing:

| Trang | Ban đầu | Cuối cùng |
|---|---|---|
| Mei | 51 | **60** |
| Music / Focus | 31–60 | **60** |
| Weather | **18** | **58** |
| Servers | 45 | **57** |
| Markets | 32 | **51–54** |

Những thay đổi tạo ra khác biệt:

1. **Chỉ vẽ trang đang hiển thị.** Trước đó mọi trang đều được vẽ lại mỗi lần có giá mới.
2. **Diff từng phần tử con.** Giá đổi thì chỉ thay `<span>` giá, giữ nguyên biểu đồ SVG bên cạnh. Trước đó cả dòng bị dựng lại vài lần mỗi giây.
3. **`will-change: transform`** cho mọi animation lặp lại. Không có nó, trình duyệt **vẽ lại cả vùng màn hình mỗi khung hình**. Riêng thay đổi này đưa Weather từ 18 lên 58 FPS.
4. **Bỏ** những hiệu ứng ép trình duyệt vẽ lại: ánh sáng chạy trên thanh đo (nằm trong `overflow:hidden`), `text-shadow` khi giá nháy, `filter: drop-shadow` trên biểu đồ.
5. Luồng trạng thái gửi xuống màn hình chỉ chứa những gì cần vẽ (khoảng 26 KB). Link bài báo và các tiêu đề liên quan ở lại trên hub.

### Lỗi #11: trang đứng hình hoàn toàn sau khi thêm sân khấu Mei

Đồng hồ hiện `--:--`, chấm kết nối đỏ. Bắt được lỗi bằng `Runtime.exceptionThrown` qua DevTools (`tools/errors.mjs`):

```
TypeError: window.stage.start is not a function
```

**Nguyên nhân:** phần tử `<div id="stage">` **tự động trở thành `window.stage`** (cơ chế "named access" của trình duyệt), đè lên object API mà `stage.js` đặt cùng tên. Đổi tên API thành `window.meiStage`.

## 18. Mei & Nhat

Ban đầu chỉ có Mei đi dạo. Sau đó thêm **Nhat**, "cậu chủ" của Mei, cao gấp khoảng 2,5 lần Mei, tóc xoăn, hoodie xanh có logo dấu chân mèo. Hai nhân vật diễn **7 màn ngẫu nhiên**: rượt đuổi (Nhat phải dâng pate mới được tha), bút laser, trộm bánh mì cá, chui thùng giấy hù Nhat, cuộn len, ngủ trưa, vuốt ve.

* Mỗi màn là một hàm `async` dùng một bộ công cụ nhỏ (`go`, `say`, `pose`, `wait`…). Mọi bước **huỷ được ngay**: nhấn núm để hỏi Mei là màn diễn dừng, Nhat lui ra, Mei chạy vào giữa nghe.
* Nhân vật di chuyển bằng `translate3d`, mỗi nhân vật một lớp GPU riêng, nên trang Mei vẫn 60 FPS khi đang diễn.
* Các màn được viết cho sân khấu rộng 800 px và được **co giãn theo chiều rộng thật**, nên chạy được cả ở chế độ dọc (480 px).

## 19. News

* **10 chủ đề** (sau rút còn 5, xem mục 21)**:** Top stories, Việt Nam, World, Business, Finance, Kinh doanh VN, Research, Science, Tech, Hacker News. Lấy từ Google News RSS (theo mục, hoặc theo từ khoá trong 24 giờ) và Hacker News API. Cập nhật **2 phút** một lần.
* **Chạm vào tin để xem tóm tắt:**
  1. Link trong RSS **không phải link bài gốc** mà là link của Google. Mình gọi lại đúng request `batchexecute` mà trang Google News dùng, để lấy link của báo.
  2. Đọc bài: `og:description` cộng các đoạn `<p>`.
  3. Gemini viết một đoạn **3–5 câu**.
  4. Với bài có paywall (ví dụ WSJ), dùng **các tiêu đề của báo khác cùng đưa tin** có sẵn trong RSS, và ghi rõ là chi tiết còn hạn chế.
* **Lỗi #12:** bản đầu bị **timeout sau 40 giây**. Đo thử: `gemini-flash-latest` mất 5,7 giây cho một đoạn ngắn (vì model "suy nghĩ"), còn **`gemini-flash-lite-latest` chỉ mất 0,8 giây**. Tóm tắt dùng bản lite: từ lúc chạm tới lúc có tóm tắt mất **1,4–2,5 giây**.
* **Lỗi #13:** tin Hacker News tiếng Anh lại bị tóm tắt **bằng tiếng Việt**. Câu lệnh "viết theo ngôn ngữ của tiêu đề" chưa đủ rõ. Hub giờ **tự nhận diện** (tiêu đề có dấu tiếng Việt thì là tiếng Việt) và ghi thẳng ngôn ngữ vào yêu cầu.

## 20. Chế độ dọc, menu nổi, 4 nút theo trang

* **Menu nổi** (nút tròn): nền phía sau mờ đi, có 4 ô (độ sáng, khởi động lại, tắt máy, xoay màn hình) và thanh kéo độ sáng. Khởi động lại và tắt máy phải bấm thêm một lần để xác nhận. Lệnh đi qua cùng kênh long-poll với micro.
* **Chế độ dọc:** toàn bộ `#app` (kích thước 480 × 800) được xoay ±90° bằng `transform`, chạy trên GPU. Mỗi trang có bố cục dọc riêng. Lựa chọn hướng màn hình lưu trong `localStorage` của chính Car Thing.
* **4 nút theo trang:**
  * News: Top, Việt Nam, Tech, chủ đề kế tiếp (lúc đầu là Top, Research, Business; xem mục 21).
  * Markets: phóng to BTC, Vàng, Tỷ giá (9 ngoại tệ Vietcombank), Chỉ số.
  * Music: ⏮ ⏯ ⏭ ♥.
  * Focus: 15, 25, 45, 60 phút.

## 21. Màn hình tự tắt, và đợt nâng cấp thứ hai

### Lỗi #14: "đôi khi máy tự tắt, đen màn hình, phải rút dây cắm lại"

Triệu chứng: màn hình tắt hẳn, bấm gì cũng không lên, phải rút cáp USB cắm lại.

Điều tra theo thứ tự:

1. **Phía server 2:** log kernel cho thấy Car Thing bị ngắt USB lúc 20:14:58 và kết nối lại lúc 20:15:21. Khoảng cách 23 giây đúng bằng thời gian khởi động, tức là lần rút cắm đó là của người dùng, không phải thiết bị tự khởi động lại.
2. **Phía Car Thing:** journal được lưu trên `/var`, mỗi lần khởi động là một thư mục riêng (vì `machine-id` đổi mỗi lần boot). Log của lần chạy bị lỗi **dừng đột ngột** lúc 20:14:32, không có dòng tắt máy nào. Thoạt nhìn giống máy bị treo. Nhưng journald chỉ ghi xuống đĩa **5 phút một lần** (`SyncIntervalSec=5m`), nên khi bị rút điện thì các dòng cuối mất hết. Log "dừng đột ngột" không chứng minh máy bị treo.
3. **Manh mối:** ngay trước đó, `nocturned` vừa bị dừng rồi chạy lại. Đây là việc `voice-agent.sh` làm mỗi khi Mei thu âm (micro bị `nocturned` giữ). Log hub cũng có câu hỏi cho Mei lúc 20:14:33.
4. **Tái hiện:** dừng rồi chạy lại `nocturned` y như voice agent, rồi đọc độ sáng mỗi giây:

   ```
   stopped: 160
   t1: 0   t2: 0   t3: 0 … t10: 0
   ```

   Mỗi lần khởi động, **`nocturned` đặt đèn nền về 0** và giữ nguyên như vậy. `brightness-sync.sh` không sửa lại, vì nó chỉ ghi độ sáng khi người dùng **đổi** độ sáng.

Vậy máy không hề tắt: **mỗi lần hỏi Mei là đèn nền tắt**. Rút cắm lại thì máy khởi động lại, đèn nền sáng lại.

Cách sửa:

* `brightness-sync.sh` giờ **kiểm tra đèn nền mỗi 2 giây** và ghi lại mức đã chọn nếu bị đổi. Đo lại: sau khi `nocturned` khởi động, màn hình sáng lại trong ≤ 2 giây.
* Phòng trường hợp máy **treo thật**: bật **watchdog phần cứng** của chip Amlogic (`RuntimeWatchdogSec=30s` trong `/etc/systemd/system.conf.d/10-watchdog.conf`). Nếu systemd không "gõ" watchdog trong 30 giây, chip tự khởi động lại máy, không cần ai rút dây.
* **`kiosk-watch.sh`:** nếu lúc Car Thing khởi động mà server 2 đang tắt, Chromium sẽ kẹt ở trang lỗi mãi mãi (code tự kết nối lại nằm trong trang của hub, mà trang đó chưa tải được). Script này hỏi DevTools trên loopback mỗi 15 giây xem trang đang mở là gì. Nếu không phải hub và hub đã trả lời thì khởi động lại kiosk. Thử bằng cách cố tình cho Chromium mở một địa chỉ sai: 15 giây sau đã tự quay về hub.

### Lỗi #15 và #16: dấu `\` biến mất trong regex

Trong lúc đọc code, mình thấy:

```js
text.match(/^s*Q:s*(.*)$/m)        // đúng ra là /^\s*Q:\s*(.*)$/m
text.match(/^s*A:s*([sS]*)$/m)     // đúng ra là /^\s*A:\s*([\s\S]*)$/m
.replace(/**/g, '')                 // đúng ra là /\*\*/g
text.replace(/d/g, '0')             // đúng ra là /\d/g (đồng hồ số BTC)
```

Các dấu `\` đã bị mất khi file được ghi qua một lớp shell nhiều tầng. Hậu quả:

* **#15:** câu trả lời của Mei không tách được phần `Q:` và `A:`. Riêng `/**/g` thì JavaScript hiểu là **một comment rỗng** theo sau là biến `g`, nên vẫn chạy mà không báo lỗi gì.
* **#16:** "đồng hồ số" giá BTC không bao giờ cuộn, vì `/d/` tìm chữ `d` chứ không phải chữ số.

Sửa cả bốn chỗ và rà lại toàn bộ code. Từ đó, mọi chỉnh sửa có regex đều dùng công cụ sửa file trực tiếp, không đi qua shell.

### Lỗi #17: Gemini 429, mới hỏi vài câu đã hết lượt

Khi thử bản tin buổi sáng, Gemini trả về `429 You exceeded your current quota`. Đọc chi tiết lỗi: `GenerateRequestsPerDayPerProjectPerModel-FreeTier`, model `gemini-3.8-flash`, **giới hạn 20 lượt mỗi ngày**. Model `flash-latest` hiện trỏ tới bản này, và gói miễn phí của bản mới chỉ có 20 lượt một ngày. Bản `flash-lite-latest` thì vẫn chạy bình thường, hạn mức cao hơn nhiều.

Cách sửa: khi model chính trả 429, hub **tự gửi lại cùng yêu cầu cho bản lite**. Mei không bao giờ "chết" vì hết lượt, và vẫn hoàn toàn miễn phí.

### Những gì thêm vào

* **Trang Lịch (Calendar).** Đọc lịch Google qua **địa chỉ iCal bí mật**: chỉ đọc, không cần OAuth, không cần app. Hub tự **giải chuỗi lặp lại** (`RRULE` hằng ngày, hằng tuần, hằng tháng, hằng năm, `BYDAY` như "thứ Ba thứ hai của tháng", `COUNT`, `UNTIL`, `EXDATE`, buổi bị dời qua `RECURRENCE-ID`), tính đúng giờ khi **đổi giờ mùa hè**. Có 5 bài test cho phần này, và đã chạy thử với lịch thật của Google (317 sự kiện). Nút 1 là hôm nay, 2 là ngày mai, 3 là cả tuần. Mười phút trước mỗi sự kiện, một banner hiện lên ở bất kỳ trang nào.
  * **Bảo mật:** ai có link iCal bí mật là đọc được lịch, nên link chỉ nằm trong `.env` của hub. Nó không bao giờ được in ra log (lỗi chỉ ghi "calendar 1: HTTP 404") và không bao giờ gửi xuống Car Thing. Nhập bằng `set-calendar-url.sh` (hiện `*` khi dán, kiểm tra link trước khi lưu), để không lưu vào lịch sử shell.
* **Mei nhớ ngữ cảnh.**
  * Mei nhớ 4 câu hỏi gần nhất trong **10 phút**, nên hỏi tiếp được kiểu "còn ETH thì sao?".
  * Khi bấm hỏi, màn hình gửi kèm **trang trước đó** và **tin đang mở**. Đang đọc tóm tắt một tin rồi chuyển sang Mei hỏi "tin này nói gì?" là Mei biết tin nào. Tin đang mở được giữ nguyên khi sang trang Mei.
  * Nút Back trên trang Mei tắt bong bóng trả lời.
* **Bản tin buổi sáng.** 7:00 mỗi sáng (giờ San Jose, đổi được bằng `BRIEFING_AT`), Mei viết một đoạn khoảng 65 từ gồm thời tiết, lịch hôm nay, BTC và vàng, tỷ giá USD/VND, 2 tin chính. Trang Mei tự bật lên, trừ khi bạn đang làm gì khác. Nút 1 trên trang Mei để xin bản tin bất cứ lúc nào. Ngày đã gửi được lưu lại, nên khởi động lại hub cũng không bị gửi hai lần. Bản tin chỉ chạy trong khoảng 2 giờ sau giờ hẹn, để khởi động lại hub vào buổi chiều không tự bật bản tin.
* **Màn hình báo mất kết nối.** Hub gửi một sự kiện `hb` mỗi 10 giây. Trước đây heartbeat là một dòng comment SSE, mà trình duyệt không báo cho JavaScript biết comment, nên trang không phân biệt được "hub đang im" với "mất kết nối". Không nhận được gì trong 25 giây thì hiện thẻ "Reconnecting to the hub…" và cứ 30 giây mở lại kết nối một lần. Mỗi lần khởi động, hub có một mã phiên bản riêng; màn hình thấy mã mới là **tự tải lại trang**, nên cập nhật giao diện không cần đụng vào Car Thing.
* **Xoay đủ 4 hướng.** Trước chỉ có ngang, dọc phải, dọc trái. Giờ thêm **ngang lộn ngược** (`rotate(180deg)`), mỗi lần bấm xoay thêm 90° theo chiều kim đồng hồ.
* **News gọn lại:** chỉ giữ Top stories, Việt Nam, Kinh doanh VN, Tech, Hacker News. Nút 1 là Top, 2 là Việt Nam, 3 là Tech, 4 là chủ đề kế tiếp.
* **GIF demo** ở đầu README: quay bằng `Page.startScreencast` của DevTools (671 khung hình trong 34 giây), ghép bằng ffmpeg trong một container dùng xong là xoá, ra GIF 560 px nặng 7,5 MB.
* **GitHub:** bật Secret scanning và Push protection, thêm một workflow kiểm tra cú pháp và chạy test mỗi lần push.

## 22. Đợt nâng cấp thứ ba: ban đêm, bảo mật, cập nhật

### Những gì thêm vào

* **Ban đêm (23:00 đến 6:30).** Hub trả về độ sáng `0`, và `brightness-sync` tắt hẳn đèn nền. Vặn núm, bấm nút hay chạm vào màn hình thì sáng lại 2 phút, mỗi lần dùng tiếp lại được cộng thêm. **Lần chạm đầu tiên chỉ để đánh thức**, không bấm vào thứ gì: chạm trong bóng tối mà lỡ bấm "Shut down" thì rất khó chịu. Lúc tối, mọi animation cũng dừng cho Car Thing nghỉ. Mức sáng ban ngày vẫn lưu trong cấu hình của `nocturned`; tắt và bật lại ban đêm chỉ ghi thẳng vào đèn nền, không khởi động lại `nocturned`, nên màn hình phản ứng trong vòng một lần poll (2 giây).
* **Báo mưa 2 giờ tới.** Open-Meteo có dữ liệu theo từng 15 phút (`minutely_15`). Trang Weather có thêm một dải "Rain likely in about 20 min" kèm 9 cột nhỏ, và khoảng 30 phút trước khi mưa, banner xanh hiện lên ở mọi trang (tối đa 3 giờ một lần).
* **Trang Servers có 4 chế độ** trên nút 1 đến 4:
  1. **Now:** như cũ.
  2. **24 h:** biểu đồ CPU, RAM, nhiệt độ của hai server, trung bình 10 phút, lưu vào `state/history.json` để khởi động lại hub không mất.
  3. **Security:** số lần đăng nhập SSH thất bại (1 giờ và 24 giờ, kèm IP thử nhiều nhất), số gói tin firewall chặn (kèm nguồn và cổng), danh sách **cổng mở trên mọi interface**, cổng Docker publish ra `0.0.0.0` (nhắc lại: Docker bỏ qua UFW), và tình trạng cài đặt của Car Thing.
  4. **Updates:** số gói `apt` chờ cập nhật, container nào có image mới hơn, và GitHub: lần chạy CI gần nhất của 4 repo mới push, số pull request và issue đang mở.
* **Script kiểm tra Car Thing sau khi cập nhật Nocturne** (`check-carthing.sh`). Cập nhật Nocturne có thể ghi đè `/etc` và `/root`. Script so từng file với bản trong repo (SHA-256), kiểm tra kiosk còn trỏ về hub, key của hub còn trong `authorized_keys`, SSH vẫn từ chối mật khẩu, đồng bộ giờ còn bật, ba script phụ còn chạy; thiếu gì thì cài lại. Nếu bản cập nhật xoá mất key, script hỏi mật khẩu root một lần (mặc định của Nocturne) để đặt lại key rồi làm tiếp bằng key. Cron chạy nó mỗi giờ ở chế độ chỉ kiểm tra; thấy lệch là banner đỏ hiện lên.
* **Thay đổi nhỏ theo yêu cầu:** trang News bỏ số trên từng chủ đề, nút 1 là chủ đề kế, nút 2 là chủ đề trước. Mei chuyển xuống trang cuối cùng. Nhãn "Landscape, upside down" tràn khỏi ô trong menu nên đổi thành "Upside down".

### Lấy dữ liệu bảo mật mà không cấp thêm quyền

Cách dễ nhất là cho hub đọc thẳng journal và `docker.sock` của host. Nhưng như thế thì một lỗi trong hub (thứ nhận dữ liệu từ Car Thing và từ internet) thành quyền root trên server. Nên làm ngược lại:

* Một script nhỏ `host-report.sh` chạy bằng **cron của user thường** mỗi 5 phút. User này nằm trong nhóm `adm`, đủ để đọc journal, không cần `sudo`. Script ghi ra một file JSON.
* Server 2: hub đọc file đó qua một **mount chỉ-đọc**. Server 1: agent đọc file (cũng chỉ-đọc) và gửi kèm số liệu, mỗi phút một lần, qua đường `/api/ingest` đã có token. Hub chỉ giữ đúng các trường mong đợi, cắt độ dài cố định.
* Kiểm tra image mới: sidecar `docker-status` (vốn đã có `docker.sock`) báo thêm tên image và digest lúc pull. Hub hỏi registry bằng `HEAD` ẩn danh (Docker Hub không tính `HEAD` vào giới hạn pull), 6 giờ một lần.
* Không mở thêm cổng nào. Hai kết nối ra ngoài mới, đều chỉ đọc: GitHub API và các registry.

Lần đầu mỗi server gửi báo cáo, mọi cổng đang mở được coi là "đã biết". Từ đó về sau, một cổng mới mở trên mọi interface sẽ bật banner và được đánh dấu **new** trong một ngày.

### Trang xem trước trên LAN không còn thấy mọi thứ

Trang `10.10.10.20:8787` vốn cho bất kỳ máy nào trong LAN xem (chỉ đọc). Với lịch, kết quả bảo mật và GitHub thì "chỉ đọc" vẫn là lộ: danh sách cổng đang mở và IP đang dò SSH chính là bản đồ cho kẻ đang dò mạng. Giờ hub gửi hai bản trạng thái: Car Thing nhận đầy đủ, mọi máy khác nhận bản đã lược bỏ lịch, bảo mật, cập nhật, GitHub, câu trả lời của Mei và các banner bảo mật. Muốn một máy cụ thể xem đầy đủ thì thêm IP vào `PREVIEW_FULL_FROM`.

Vì lý do tương tự, ảnh chụp trong README **không có** chế độ 24 h, Security và Updates: chúng hiện địa chỉ, cổng và tên container thật trong mạng nhà.

### Lỗi #19: chạm trong bóng tối vẫn lọt một phím

Thử trên máy thật: lúc màn hình tối, bấm hai lần sang phải cách nhau 300 ms. Lần đầu chỉ đánh thức, đúng. **Lần hai lại chuyển trang.** Lý do: hub trả lời và đẩy trạng thái "đã sáng" về trong khoảng 300 ms, trong khi đèn nền phải đợi `brightness-sync` poll (tối đa 2 giây) mới thật sự sáng. Với màn hình, "đã sáng" sớm hơn với mắt người gần 2 giây. Sửa: sau khi gửi lệnh đánh thức, mọi thao tác trong 2,5 giây tiếp theo vẫn bị nuốt. Thử lại: hai phím lúc tối không làm gì, phím thứ ba (đã sáng) chuyển trang bình thường.

### Lỗi #20: `systemctl reload sshd` báo không có unit

Lần chạy đầu của `check-carthing.sh` ở chế độ sửa báo `Unit sshd.service not found`. Trên Nocturne, SSH được **kích hoạt qua socket** (`sshd.socket`): mỗi kết nối mới chạy một tiến trình `sshd` riêng và tự đọc lại cấu hình. Không có gì để reload, chỉ cần `sshd -t` kiểm tra cú pháp. Hướng dẫn trong SETUP cũng sửa theo.

### Lỗi #21: firewall "chặn" chính Car Thing hàng chục lần

Bản đầu của `host-report.sh` đếm mọi dòng `[UFW BLOCK]`: hơn 2.000 mỗi ngày. Phần lớn là multicast IPv6 của router (`ff02::1`), thứ mọi mạng LAN đều có. Bỏ multicast và broadcast đi vẫn còn Car Thing → 8787 bị chặn 78 lần. Hoá ra đa số là **gói ACK/FIN đến muộn** của các kết nối đã đóng (long-poll của Mei, SSE), conntrack coi là không hợp lệ nên UFW ghi log. Giờ chỉ đếm **lần mở kết nối mới** (TCP có SYN, không có ACK) và gói UDP. Những gì còn lại là thật: Car Thing gõ vào cổng 8787 lúc hub đang khởi động lại (cổng Docker tạm thời biến mất), và vài lần Car Thing thử một cổng khác trên server 2. Firewall chặn đúng như thiết kế.

### Những thứ chạm vào bàn phím mà không ai nghĩ tới

Khi lật ngược màn hình 180°, núm vặn **không** bị ngược: xoay trong mặt phẳng màn hình thì chiều kim đồng hồ vẫn là chiều kim đồng hồ. Thứ bị ngược là những thứ dựa trên toạ độ:

* **Vuốt** để đổi trang: trình duyệt báo toạ độ của màn hình, không phải của giao diện đã xoay, nên lật ngược thì vuốt trái thành vuốt phải, còn ở chế độ dọc thì vuốt ngang thành vuốt dọc. Giờ toạ độ được đổi sang hệ của giao diện trước khi tính.
* **Chạm vào thanh độ sáng**: dùng `offsetX` (toạ độ trong chính phần tử, đã tính phép xoay) thay cho `clientX`.
* **4 nút preset**: lật ngược thì chúng nằm ở cạnh dưới theo thứ tự 4-3-2-1. Hub đảo lại để nút bên trái luôn là nút 1.

## 23. Bảng tổng hợp lỗi

| # | Triệu chứng | Nguyên nhân gốc | Cách sửa |
|---|---|---|---|
| 1 | Máy tính không nhận IP từ Car Thing | dnsmasq + `bind-interfaces` → `SO_BINDTODEVICE` không có trên kernel 4.9 | Cấu hình riêng không dùng `bind-interfaces`; sau đó nâng lên v4 |
| 2 | Flash timeout | Xoá 1,4 GB lâu hơn thời gian chờ USB | Chạy lại; việc xoá vẫn tiếp tục ở phía thiết bị |
| 3 | ENOTFOUND chỉ trong container | musl coi AAAA NXDOMAIN là lỗi toàn cục | Dùng image Debian (glibc) |
| 4 | Yahoo 429 | Gọi song song + chặn theo User-Agent | Endpoint `spark` gộp mã, UA ngắn |
| 5 | Đồng hồ sai | Car Thing không có NTP | Lấy giờ server qua SSE, sau đó thêm chrony |
| 6 | Chữ tràn trên thiết bị | Font thật khác font trên PC | Luôn chụp màn hình trên thiết bị qua DevTools |
| 7 | SSH tự bị kill | `pgrep -f` khớp với chính lệnh đang chạy | Kill qua file PID |
| — | Màn hình quá tối | `nocturned` chế độ auto theo cảm biến | Ghi `auto:false` vào file cấu hình + restart daemon |
| — | Mất cấu hình sau khi khởi động lại | `nocturne-floor-sync` khôi phục `/opt/nocturne` | Chuyển sang `/var/lib/hub` + trỏ override file |
| — | Hub không chạy khi chưa cắm Car Thing | Docker không bind được IP chưa tồn tại | `ip_nonlocal_bind=1` |
| 8 | Key Gemini bị lưu sai | PowerShell phá dấu nháy lồng nhau | Script đặt sẵn trên server, hiện `*`, kiểm tra key trước khi lưu |
| 9 | Mei bịa ra câu hỏi | Thu từ kênh loopback câm; micro thật bị giữ; ngưỡng tính trên số liệu có DC | `hw:0,0`, tạm dừng nocturned, trừ DC, phát hiện giọng nói tương đối, trạng thái "getting ready" |
| 10 | Icon nhạc thành ô màu | Font emoji màu | Icon SVG |
| 11 | Trang đứng hình | `id="stage"` tự thành `window.stage` | Đổi tên API |
| 12 | Tóm tắt tin timeout | Model chính "suy nghĩ" lâu | Dùng `flash-lite` (0,8 giây) |
| 13 | Tin tiếng Anh bị tóm tắt tiếng Việt | Câu lệnh ngôn ngữ mơ hồ | Hub tự nhận diện ngôn ngữ |
| 14 | Màn hình đen sau khi hỏi Mei, phải rút cắm lại | `nocturned` đặt đèn nền về 0 mỗi lần khởi động lại | `brightness-sync` kiểm tra mỗi 2 giây; thêm watchdog phần cứng và `kiosk-watch` |
| 15 | Mei không tách được Q/A | Dấu `\` trong regex bị mất khi ghi file qua shell | Sửa regex, không sửa code qua shell nữa |
| 16 | Đồng hồ số BTC không cuộn | Cùng nguyên nhân: `/d/` thay vì `/\d/` | Như trên |
| 17 | Gemini 429 sau vài câu hỏi | Gói miễn phí của model Flash mới chỉ có 20 lượt/ngày | Tự chuyển sang Flash-Lite khi gặp 429 |
| 18 | Kẹt trang lỗi nếu hub tắt lúc Car Thing khởi động | Code tự kết nối lại nằm trong trang chưa tải được | `kiosk-watch.sh` khởi động lại kiosk khi hub trả lời |
| 19 | Chạm lúc màn hình tối vẫn lọt một phím | Trạng thái "đã sáng" về trước khi đèn nền sáng thật (tối đa 2 giây) | Nuốt mọi thao tác trong 2,5 giây sau khi đánh thức |
| 20 | `reload sshd` thất bại trên Car Thing | SSH của Nocturne kích hoạt qua socket, không có `sshd.service` | Chỉ cần `sshd -t` |
| 21 | Số gói bị chặn cao bất thường | Đếm cả multicast và gói ACK/FIN muộn của kết nối đã đóng | Chỉ đếm lần mở kết nối mới |

## 24. Những điều rút ra

1. **Đo trên thiết bị thật, không đoán.** Font, FPS, mức âm thanh của micro, giờ hệ thống: lần nào thiết bị thật cũng khác với giả định.
2. **"Không tin mặc định" là công cụ thiết kế, không chỉ là bảo mật.** Nó quyết định Car Thing không giữ key, hub không cầm `docker.sock`, agent chỉ đẩy dữ liệu đi, và firewall nằm trên đúng máy.
3. **Bind vào một IP không phải là firewall.** Weak host model của Linux và cách Docker bỏ qua UFW là hai cái bẫy rất dễ bước vào.
4. **Firmware của người khác có luật chơi riêng.** Phân vùng chỉ-đọc, `floor-sync`, daemon tự chỉnh độ sáng, daemon giữ micro: muốn sống chung thì phải đọc code của họ trước.
5. **Miễn phí là một ràng buộc thiết kế.** Nó loại Binance (bị chặn), loại grounding của Gemini (đã thành trả phí), và đẩy sang những giải pháp khéo hơn: OKX WebSocket, Yahoo `spark`, RSS kèm tóm tắt.
6. **Hiệu năng trên phần cứng yếu nằm ở việc tránh vẽ lại, không phải ở việc viết code nhanh.** `will-change` và việc chỉ cập nhật phần tử thay đổi mạnh hơn mọi tối ưu JavaScript khác.
