# Mạng của iPhone qua Bluetooth (BNEP)

Ghi chú để quay lại sau. **Trạng thái (19/10/2026): module đã dựng xong, chưa nạp lần nào, chưa thử.**

## Nó là gì

Car Thing không có Wi-Fi; mạng duy nhất là dây USB tới server 2 (`uncm0`, 10.42.1.2 ↔ 10.42.1.6). Trên xe thì không có mạng gì cả.

iPhone chia sẻ được 4G qua Bluetooth (Personal Hotspot, dịch vụ NAP). Phía Linux cần module nhân **BNEP** cho việc này, mà nhân của Nocturne lại dựng với `CONFIG_BT_BNEP` tắt. Có nhạc, có thông báo vẫn chưa đủ, phải có BNEP thì mới có mạng.

Module nạp ngoài được vì nhân này không bật `MODVERSIONS`, `MODULE_SIG` hay `RANDSTRUCT`. Nghĩa là nó chỉ kiểm tra một chuỗi "vermagic" (`7.0.2-superbird SMP preempt mod_unload aarch64`). Chuỗi đó khớp khi dựng `bnep.ko` từ đúng mã Linux 7.0.2 gốc, đúng cấu hình của máy (`/proc/config.gz`) và đúng GCC 15.2.

## Các file

| File | Ở đâu khi dùng | Để làm gì |
|---|---|---|
| `tools/build-bnep.sh` | server 2, `~/carthing-tools/` | Dựng `bnep.ko` trong container Debian bỏ đi sau khi xong |
| `~/carthing-tools/bnep.ko` | server 2 (không nằm trong repo) | Bản đã dựng, SHA-256 `40f67b24ac0a69c39e1567f2d76189b760aa79fc3546a040d2eeb3114cf56604` |
| `~/kbuild/` | server 2 | Mã nhân và trình biên dịch khi dựng. Đã xoá lúc đóng dự án (20/10/2026); script tự tải lại và kiểm tra checksum |
| `sshd-usb-only.conf` | Car Thing `/etc/systemd/system/sshd.socket.d/10-usb-only.conf` | SSH chỉ nghe trên dây USB |
| `resolved-no-llmnr.conf` | Car Thing `/etc/systemd/resolved.conf.d/10-no-llmnr.conf` | Tắt LLMNR/mDNS đang nghe ở mọi mạng |
| `80-bnep.network` | Car Thing `/etc/systemd/network/80-bnep.network` | Lấy địa chỉ và DNS từ iPhone cho `bnep0` |

`check-carthing.sh` **không** tự cài các file này. Cố ý vậy: chưa thử, và sai chỗ sshd thì mất đường vào máy.

## 0. Dựng lại (chỉ khi cần)

Cần dựng lại khi Nocturne cập nhật nhân, tức `uname -r` trên Car Thing không còn là `7.0.2-superbird`. Dấu hiệu là `insmod` báo `Invalid module format`, hoặc `dmesg` có dòng `version magic ... should be ...`.

```bash
# trên server 2
~/carthing-tools/build-bnep.sh
```

Script tự lấy `uname -r` và `/proc/config.gz` từ Car Thing, rồi tải mã nhân cùng phiên bản và kiểm tra nó với danh sách SHA-256 của kernel.org. Sau khi dựng, nó so vermagic với nhân đang chạy. Nhân mới mà bật ký module hay symbol versions thì script dừng và báo lỗi: lúc đó không còn cách nạp module ngoài nữa. Trong log, đoạn `diff` cấu hình thường có thêm các dòng BNEP và hai dòng `CONFIG_TOUCHSCREEN_TLSC6X`, `CONFIG_OPENSSL_SUPPORTS_ML_DSA`: driver màn hình cảm ứng riêng của Car Thing không có trong mã gốc, và dòng kia phụ thuộc OpenSSL của máy dựng. Cả hai không ảnh hưởng tới BNEP. Dựng lại với cùng nhân cho ra đúng file cũ, cùng SHA-256. Lần đầu chạy lâu nhất ở bước `modules_prepare`; các lần sau dùng lại `~/kbuild`.

## 1. Khóa cửa trước

**Nói đơn giản:** khi Car Thing vào hotspot của iPhone, nó chung một mạng nhỏ với mọi máy khác đang dùng hotspot đó, ví dụ laptop của bạn hay máy người ngồi cạnh. Nhân của Car Thing không có tường lửa (không có netfilter), nên dịch vụ nào đang nghe "ở mọi nơi" thì các máy đó đều gõ cửa được. SSH vẫn chỉ vào được bằng khóa, nhưng không có lý do gì để mở nó ra mạng đó.

**Kỹ thuật:** đang nghe trên mọi giao diện có:
- sshd cổng 22, qua socket activation `sshd.socket`, `ListenStream=22`;
- systemd-resolved LLMNR, cổng 5355;
- avahi mDNS, cổng 5353.

DHCP server của networkd (cổng 67) chỉ phục vụ `uncm0`. Hai file conf ở trên giới hạn SSH vào 10.42.1.2 và tắt LLMNR/mDNS của resolved.

```bash
# trên server 2, trong thư mục repo
K="-i ~/.ssh/carthing_ed25519"; CT=root@10.42.1.2
ssh $K $CT 'mount -o remount,rw / && mkdir -p /etc/systemd/system/sshd.socket.d /etc/systemd/resolved.conf.d'
scp $K carthing/bnep/sshd-usb-only.conf     $CT:/etc/systemd/system/sshd.socket.d/10-usb-only.conf
scp $K carthing/bnep/resolved-no-llmnr.conf $CT:/etc/systemd/resolved.conf.d/10-no-llmnr.conf
scp $K carthing/bnep/80-bnep.network        $CT:/etc/systemd/network/80-bnep.network
# giữ phiên này mở; khởi động lại socket không cắt các phiên SSH đang có
ssh $K $CT 'systemctl daemon-reload && systemctl restart sshd.socket systemd-resolved && sync; mount -o remount,ro /'
```

Kiểm tra bằng một phiên SSH **mới** từ server 2: `ssh $K $CT true`. Nếu không vào được thì dùng phiên cũ, xóa `/etc/systemd/system/sshd.socket.d/10-usb-only.conf`, rồi `daemon-reload` và `restart sshd.socket`.

avahi chưa xử lý. Nếu không cần thì `systemctl mask --now avahi-daemon` (cần remount rw như trên); mình chưa kiểm tra Nocturne có dùng nó không.

## 2. Nạp module

```bash
scp $K ~/carthing-tools/bnep.ko $CT:/var/lib/hub/bnep.ko     # /var ghi được và còn sau khi khởi động lại
ssh $K $CT 'insmod /var/lib/hub/bnep.ko && lsmod | grep bnep; dmesg | tail -5'
```

`dmesg` sẽ có `BNEP (Ethernet Emulation) ver 1.3`. Không dùng `modprobe` được, vì root chỉ đọc và không có `/lib/modules/7.0.2-superbird`.

Module mất sau khi khởi động lại. Muốn nạp tự động thì thêm `insmod /var/lib/hub/bnep.ko` vào một unit chạy trước `bluetooth.service`; phần này chưa làm.

## 3. Nối vào hotspot của iPhone

1. Trên iPhone: Settings → Personal Hotspot → bật **Allow Others to Join**. Mạng này tốn dữ liệu di động.
2. Trên Car Thing, tìm địa chỉ Bluetooth của iPhone. iPhone phải đã ghép đôi qua Bluetooth thường (BR/EDR), không chỉ qua LE.
   ```bash
   bluetoothctl devices Paired
   ```
3. Gọi dịch vụ NAP qua bluetoothd (plugin network có sẵn trong bluetoothd của Nocturne). Thay `XX_XX_…` bằng địa chỉ iPhone, dấu `:` đổi thành `_`:
   ```bash
   dbus-send --system --print-reply --dest=org.bluez /org/bluez/hci0/dev_XX_XX_XX_XX_XX_XX org.bluez.Network1.Connect string:nap
   ```
   Lệnh trả về `string "bnep0"`. networkd (theo `80-bnep.network`) xin địa chỉ trong dải 172.20.10.x từ iPhone.
4. Kiểm tra:
   ```bash
   ip -4 addr show bnep0
   ip route                       # 10.42.1.0/29 vẫn đi qua uncm0; mặc định đi qua bnep0
   ping -c 3 1.1.1.1
   ```
5. Ngắt: `dbus-send --system --print-reply --dest=org.bluez /org/bluez/hci0/dev_XX_… org.bluez.Network1.Disconnect`, rồi `rmmod bnep`.

## Sau khi bật, cái gì tới được cái gì

- **Car Thing → internet:** đi qua iPhone (iPhone NAT), dùng mọi cổng ra ngoài. Hiện chưa có phần mềm nào trên Car Thing cần internet; trang trên xe chỉ dùng phonelink và gói dữ liệu đã chép sẵn.
- **Máy khác trên cùng hotspot → Car Thing:** sau bước 1 không còn cổng TCP nào mở ra `bnep0`. Còn avahi 5353/udp nếu chưa tắt nó.
- **Internet → Car Thing:** không tới được, vì iPhone không chuyển kết nối từ ngoài vào.
- **Server 2 ↔ Car Thing:** không đổi, vẫn qua USB.

## Gỡ hết

```bash
ssh $K $CT 'rmmod bnep; rm -f /var/lib/hub/bnep.ko'
ssh $K $CT 'mount -o remount,rw / && rm -f /etc/systemd/system/sshd.socket.d/10-usb-only.conf /etc/systemd/resolved.conf.d/10-no-llmnr.conf /etc/systemd/network/80-bnep.network && systemctl daemon-reload && systemctl restart sshd.socket systemd-resolved && sync; mount -o remount,ro /'
```

## Lỗi hay gặp

| Thấy gì | Nghĩa là |
|---|---|
| `insmod: ... Invalid module format` | Nhân đã đổi. Chạy lại bước 0 |
| `Unknown symbol ...` trong `dmesg` | Một hàm BNEP cần mà nhân không có. Xem lại đoạn `diff` cấu hình trong log dựng |
| `Network1.Connect`: `org.bluez.Error.Failed` / `NotSupported` | Hotspot iPhone chưa bật, hoặc iPhone chưa ghép đôi BR/EDR |
| `bnep0` có nhưng không có địa chỉ | `80-bnep.network` chưa cài, hoặc networkd chưa nạp lại (`networkctl reload`) |
