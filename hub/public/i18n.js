'use strict';
// Screen language. The choice lives on the hub (quick menu → Language), so the hub's own messages
// (banners, Mei's briefing) follow it too. English strings are the keys; {name} marks a value.

let lang = 'en';
try { if (localStorage.getItem('lang') === 'vi') lang = 'vi'; } catch {} // last choice, until the hub answers

const VI = {
  // pages
  News: 'Tin tức', Markets: 'Thị trường', Weather: 'Thời tiết', Calendar: 'Lịch', Music: 'Nhạc', Servers: 'Máy chủ', Focus: 'Tập trung', Mei: 'Mei',

  // markets
  '24h low': 'thấp 24h', high: 'cao', open: 'mở cửa', Gold: 'Vàng', Silver: 'Bạc', 'Gold & Silver': 'Vàng & Bạc', Indices: 'Chỉ số',

  // weather
  Clear: 'Quang đãng', 'Mostly clear': 'Ít mây', 'Partly cloudy': 'Có mây', Overcast: 'Nhiều mây', Fog: 'Sương mù',
  'Light drizzle': 'Mưa phùn nhẹ', Drizzle: 'Mưa phùn', 'Heavy drizzle': 'Mưa phùn dày', 'Light rain': 'Mưa nhẹ', Rain: 'Mưa', 'Heavy rain': 'Mưa to',
  'Light snow': 'Tuyết nhẹ', Snow: 'Tuyết', 'Heavy snow': 'Tuyết dày', 'Light showers': 'Mưa rào nhẹ', Showers: 'Mưa rào', 'Heavy showers': 'Mưa rào to',
  Thunderstorm: 'Dông', 'Thunderstorm, hail': 'Dông, mưa đá',
  Good: 'Tốt', Moderate: 'Trung bình', 'Unhealthy (sensitive)': 'Kém (nhóm nhạy cảm)', Unhealthy: 'Kém', 'Very unhealthy': 'Rất kém', Hazardous: 'Nguy hại',
  'Feels like {v}': 'Cảm giác như {v}', 'Humidity {v}%': 'Độ ẩm {v}%', 'Wind {v}': 'Gió {v}', 'Today {v}': 'Hôm nay {v}', 'AQI (US)': 'AQI (Mỹ)',
  '{day} · {p}% rain': '{day} · mưa {p}%', 'switch to {u}': 'đổi sang {u}',
  'No rain in the next 2 hours': 'Không mưa trong 2 giờ tới', 'Rain likely in about {n} min': 'Có thể mưa trong khoảng {n} phút nữa',
  'Rain now, easing in about {n} min': 'Đang mưa, khoảng {n} phút nữa sẽ ngớt', 'Rain now, for the next two hours': 'Đang mưa, kéo dài 2 giờ tới',
  'now · 2 h': 'bây giờ · 2 giờ',

  // news
  'Top stories': 'Tin chính', Tech: 'Công nghệ', next: 'tiếp', back: 'lùi', 'updated {t}': 'cập nhật {t}', 'just now': 'vừa xong',
  '{n}m ago': '{n} phút trước', '{n}h ago': '{n} giờ trước', '{n}d ago': '{n} ngày trước', '{n} points': '{n} điểm',
  'Loading headlines…': 'Đang tải tin…', 'Reading the article and summarising…': 'Đang đọc bài và tóm tắt…',
  'Could not summarise this story: {e}': 'Không tóm tắt được tin này: {e}', 'the hub did not answer': 'hub không trả lời',
  'Turn the knob for the next story · Back to close': 'Vặn núm để sang tin kế · Back để đóng',

  // calendar
  Today: 'Hôm nay', Tomorrow: 'Ngày mai', Week: 'Tuần', 'Next up': 'Sắp tới', 'Happening now': 'Đang diễn ra',
  'No calendar linked': 'Chưa nối lịch', 'Run set-calendar-url.sh on server 2': 'Chạy set-calendar-url.sh trên server 2',
  'Paste the secret iCal address of your Google Calendar into set-calendar-url.sh on server 2, and your events show up here.':
    'Dán địa chỉ iCal bí mật của Google Calendar vào set-calendar-url.sh trên server 2, sự kiện sẽ hiện ở đây.',
  'ends {t}': 'kết thúc {t}', now: 'bây giờ', 'in {n} min': '{n} phút nữa', 'in {h} h': '{h} giờ nữa', 'in {h} h {m} min': '{h} giờ {m} phút nữa', 'in {n} days': '{n} ngày nữa',
  'Nothing else scheduled': 'Không còn lịch nào', 'Enjoy the free time': 'Tận hưởng thời gian rảnh', free: 'trống',
  'Nothing left today': 'Hôm nay không còn gì', 'Nothing planned': 'Không có lịch', 'all day': 'cả ngày',

  // servers
  Now: 'Hiện tại', '24 h': '24 giờ', Security: 'Bảo mật', Updates: 'Cập nhật', Online: 'Trực tuyến', Offline: 'Mất kết nối', laptop: 'laptop',
  CPU: 'CPU', Memory: 'RAM', Disk: 'Ổ đĩa', Battery: 'Pin', Temperature: 'Nhiệt độ', 'Load (1/5/15)': 'Tải (1/5/15)', Uptime: 'Thời gian chạy', 'Network latency': 'Độ trễ mạng',
  Containers: 'Container', '{n} running': '{n} đang chạy', '{n} stopped': '{n} đã dừng', '{n} failing': '{n} lỗi', '✓ all up': '✓ tất cả chạy', '+{n} more': '+{n} nữa',
  'No stats from the server 1 agent yet.': 'Chưa nhận được số liệu từ agent của server 1.',
  'No history yet.': 'Chưa có lịch sử.', 'last 24 hours · 10-minute averages': '24 giờ qua · trung bình 10 phút', 'peak {v}': 'cao nhất {v}', Temp: 'Nhiệt độ',
  '24 h ago': '24 giờ trước', '12 h': '12 giờ',
  'Security details show on the Car Thing only.': 'Thông tin bảo mật chỉ hiện trên Car Thing.',
  'No report yet. host-report.sh runs from cron on this server (docs/SETUP.md).': 'Chưa có báo cáo. host-report.sh chạy bằng cron trên server này (docs/SETUP.md).',
  'checked {t}': '{t}', Look: 'Cần xem', Quiet: 'Ổn', 'Failed SSH logins': 'SSH đăng nhập sai', 'Blocked by the firewall': 'Firewall đã chặn', '1 h · 24 h': '1 giờ · 24 giờ',
  'most from {ip} ({n})': 'nhiều nhất từ {ip} ({n})', 'Open on every interface': 'Mở trên mọi interface', nothing: 'không có',
  'Docker, published on 0.0.0.0 (skips UFW)': 'Docker publish ra 0.0.0.0 (bỏ qua UFW)', new: 'mới',
  'Not checked yet. check-carthing.sh runs hourly from cron on server 2.': 'Chưa kiểm tra. check-carthing.sh chạy mỗi giờ bằng cron trên server 2.',
  'No SSH access with the hub key. Run check-carthing.sh on server 2.': 'Không SSH được bằng key của hub. Chạy check-carthing.sh trên server 2.',
  '{n} thing to put back': '{n} thứ cần cài lại', '{n} things to put back': '{n} thứ cần cài lại', 'Run check-carthing.sh on server 2 to fix.': 'Chạy check-carthing.sh trên server 2 để sửa.',
  '✓ Setup intact': '✓ Cài đặt còn nguyên', 'Key-only SSH, watchdog, time sync, kiosk and helpers all in place.': 'SSH chỉ dùng key, watchdog, đồng bộ giờ, kiosk và các script phụ đều còn.',
  Checked: 'Kiểm tra', Nocturne: 'Nocturne',
  'Update details show on the Car Thing only.': 'Thông tin cập nhật chỉ hiện trên Car Thing.', 'reboot needed': 'cần khởi động lại',
  'apt packages': 'Gói apt', '{n} security': '{n} bảo mật', 'Images with a newer version': 'Image có bản mới', '{a} of {b}': '{a} / {b}',
  'Set GITHUB_USER in the hub .env to see CI runs and open issues here.': 'Đặt GITHUB_USER trong .env của hub để xem CI và issue ở đây.',
  'Asking GitHub…': 'Đang hỏi GitHub…', running: 'đang chạy', success: 'thành công', failure: 'thất bại', cancelled: 'đã huỷ', skipped: 'bỏ qua', 'no workflows': 'không có workflow',
  'Open: {p} · {i}': 'Đang mở: {p} · {i}', '{n} pull request': '{n} pull request', '{n} pull requests': '{n} pull request', '{n} issue': '{n} issue', '{n} issues': '{n} issue',
  'images checked {t}': 'đã kiểm tra image {t}', 'images not checked yet': 'chưa kiểm tra image',

  // focus
  Break: 'Nghỉ', ' · paused': ' · tạm dừng', '{n} session completed': 'Xong {n} phiên', '{n} sessions completed': 'Xong {n} phiên',
  'Break over — back to focus': 'Hết giờ nghỉ, quay lại tập trung', 'Session done — take a break': 'Xong một phiên, nghỉ chút nhé',
  'Pause the timer to change its length': 'Dừng đồng hồ trước khi đổi thời gian', 'Focus · {n} min': 'Tập trung · {n} phút',
  'Press the knob to start or pause · buttons 1–4 set 15, 25, 45 or 60 minutes': 'Bấm núm để chạy hoặc dừng · nút 1–4 chọn 15, 25, 45 hoặc 60 phút',
  'Editing · turn knob to change minutes · Back to finish': 'Đang chỉnh · vặn núm để đổi số phút · Back để xong',

  // music
  'Spotify not linked': 'Chưa nối Spotify', 'Linking is done once from a browser on the LAN.': 'Chỉ cần nối một lần từ trình duyệt trong LAN.',
  'Nothing playing': 'Không phát gì', 'Start Spotify on any device, then control it here.': 'Mở Spotify trên thiết bị bất kỳ rồi điều khiển ở đây.',
  'volume {v}%': 'âm lượng {v}%', 'This device does not allow volume control': 'Thiết bị này không cho chỉnh âm lượng',
  'Controls work on the Car Thing only': 'Chỉ điều khiển được trên Car Thing', 'Volume · turn the knob · Back when done': 'Âm lượng · vặn núm · Back khi xong',

  // mei
  ready: 'sẵn sàng', 'needs a key': 'cần key', 'getting ready': 'đang chuẩn bị', 'listening · {n}s': 'đang nghe · {n}s', thinking: 'đang nghĩ',
  'writing your briefing': 'đang viết bản tin', briefing: 'bản tin', answered: 'đã trả lời', oops: 'ối',
  'Gemini API key not set on the hub yet': 'Hub chưa có Gemini API key',
  'Press the knob and ask me anything · button 1 for today’s briefing': 'Bấm núm rồi hỏi mình bất cứ điều gì · nút 1 để nghe bản tin hôm nay',
  'Waking up the microphone… start talking when it says Listening': 'Đang mở micro… nói khi thấy chữ đang nghe',
  'Press the knob when you are done · max {n}s': 'Bấm núm khi nói xong · tối đa {n}s', 'Hmm, let me think…': 'Hmm, để mình nghĩ…',
  'Press the knob to ask again · Back to close': 'Bấm núm để hỏi tiếp · Back để đóng', 'Press the knob to try again · Back to close': 'Bấm núm để thử lại · Back để đóng',
  'Your briefing for today': 'Bản tin hôm nay của bạn', 'Searched Google: {q}': 'Đã tìm Google: {q}', 'Sources: {s}': 'Nguồn: {s}',
  'Briefings start on the Car Thing only': 'Chỉ xin bản tin được trên Car Thing', 'Assistant unavailable': 'Trợ lý không phản hồi',
  'Mei only listens on the Car Thing': 'Mei chỉ nghe trên Car Thing', 'Could not reach the hub': 'Không kết nối được hub',
  "Hi! I'm Mei 🐾": 'Chào! Mình là Mei 🐾', 'Ask me about prices, the weather, your servers… or anything at all.': 'Hỏi mình về giá cả, thời tiết, máy chủ… hay bất cứ điều gì.',
  'your desk cat · powered by Gemini': 'mèo để bàn của bạn · chạy bằng Gemini',
  // messages from the hub
  'GEMINI_API_KEY is not set on the hub.': 'Hub chưa có GEMINI_API_KEY.',
  'The microphone did not open. Press the knob to try again.': 'Micro không mở được. Bấm núm để thử lại.',
  'No audio arrived from the Car Thing.': 'Không nhận được âm thanh từ Car Thing.',
  "Meow? I didn't hear anything. Hold the Car Thing closer and speak up, then press the knob again.": 'Meo? Mình không nghe thấy gì. Lại gần Car Thing, nói to hơn rồi bấm núm lần nữa.',
  'Answers show on the Car Thing only.': 'Câu trả lời chỉ hiện trên Car Thing.',

  // quick menu
  Brightness: 'Độ sáng', Restart: 'Khởi động lại', 'Shut down': 'Tắt máy', Language: 'Ngôn ngữ',
  Landscape: 'Ngang', 'Portrait ↻': 'Dọc ↻', 'Upside down': 'Lộn ngược', 'Portrait ↺': 'Dọc ↺',
  'Turn the knob to change brightness · press the knob or Back when done': 'Vặn núm để chỉnh độ sáng · bấm núm hoặc Back khi xong',
  'Press the knob again to restart · Back to cancel': 'Bấm núm lần nữa để khởi động lại · Back để huỷ',
  'Press the knob again to shut down · Back to cancel': 'Bấm núm lần nữa để tắt máy · Back để huỷ',
  'Turn the knob to choose · press the knob to select · Back to close': 'Vặn núm để di chuyển · bấm núm để chọn · Back để đóng',
  'Restarting the Car Thing…': 'Đang khởi động lại Car Thing…', 'Shutting down — unplug and replug to start again': 'Đang tắt máy, rút ra cắm lại để bật',
  'Only the Car Thing can do this': 'Chỉ Car Thing làm được việc này', 'Brightness can only be changed on the Car Thing': 'Chỉ chỉnh độ sáng được trên Car Thing',
  'Language can only be changed on the Car Thing': 'Chỉ đổi ngôn ngữ được trên Car Thing',

  // iPhone over Bluetooth
  'Pair iPhone': 'Ghép iPhone', 'Pair your iPhone': 'Ghép iPhone của bạn', 'Type this code on your iPhone': 'Nhập mã này trên iPhone',
  'On the iPhone: Settings → Bluetooth → tap “Desk Hub” (or “{a}”, if this iPhone met the Car Thing before)': 'Trên iPhone: Cài đặt → Bluetooth → chạm “Desk Hub” (hoặc “{a}” nếu iPhone từng gặp Car Thing này)',
  '{s} s left · Back to cancel': 'còn {s} giây · Back để huỷ',
  'Press the knob again to forget this iPhone · Back to cancel': 'Bấm núm lần nữa để quên iPhone này · Back để huỷ',
  Phone: 'Điện thoại', 'Unknown caller': 'Không rõ người gọi', Answer: 'Nghe', Decline: 'Từ chối',
  'Find my iPhone': 'Tìm iPhone', 'Stop the sound': 'Tắt tiếng', 'Plays music loudly on the iPhone': 'Phát nhạc to trên iPhone',
  'right here': 'ngay cạnh đây', 'about {m} m away': 'cách khoảng {m} m',
  'No app on the iPhone can play right now': 'Trên iPhone chưa có app nào phát nhạc được', 'Playing on the iPhone for 30 s': 'Đang phát trên iPhone trong 30 giây',
  'At the desk today': 'Ở bàn hôm nay', '{h} h {m} min': '{h} giờ {m} phút', '{m} min without a break': 'ngồi liền {m} phút',
  Mon: 'T2', Tue: 'T3', Wed: 'T4', Thu: 'T5', Fri: 'T6', Sat: 'T7', Sun: 'CN',
  'Reply with Siri': 'Trả lời qua Siri', 'Siri is listening: say “Reply to {n}” and your message': 'Siri đang nghe: nói “Trả lời {n}” rồi đọc tin nhắn',
  'Siri (hold)': 'Siri (giữ)', 'Camera shutter': 'Chụp ảnh', 'Hide messages': 'Ẩn tin nhắn', 'Show messages': 'Hiện tin nhắn',
  'Messages hidden on this screen': 'Đã ẩn nội dung tin nhắn trên màn hình này', 'Messages shown': 'Đã hiện nội dung tin nhắn',
  'At the desk': 'Ở bàn', Away: 'Đi vắng', 'Not connected': 'Chưa kết nối', 'Only on the Car Thing': 'Chỉ có trên Car Thing',
  'No iPhone paired': 'Chưa ghép iPhone', 'Press the knob to pair your iPhone': 'Bấm núm để ghép iPhone',
  'No notifications': 'Không có thông báo', 'The iPhone is not connected': 'iPhone chưa kết nối',
  'Press again to clear it on the iPhone': 'Bấm lần nữa để xoá trên iPhone', 'Cleared on the iPhone': 'Đã xoá trên iPhone',
  'While you were away': 'Trong lúc bạn đi', 'Missed calls': 'Cuộc gọi nhỡ', 'Any button closes this': 'Bấm nút bất kỳ để đóng',
  'Good morning 👋': 'Chào buổi sáng 👋', 'Good afternoon 👋': 'Chào buổi chiều 👋', 'Good evening 👋': 'Chào buổi tối 👋',
  'iPhone battery at {n}%': 'Pin iPhone còn {n}%', 'iPhone is fully charged: you can unplug it': 'iPhone đã đầy pin, có thể rút sạc',
  'The Bluetooth helper is not running': 'Chương trình Bluetooth trên Car Thing chưa chạy',

  // offline card
  'Reconnecting to the hub…': 'Đang kết nối lại với hub…', 'No data for': 'Không có dữ liệu trong',
  'The screen comes back on its own when server 2 answers.': 'Màn hình sẽ tự trở lại khi server 2 trả lời.',
};

// tr('in {n} min', { n: 5 }) → "in 5 min" or "5 phút nữa"
function tr(s, v) {
  let r = lang === 'vi' && VI[s] != null ? VI[s] : s;
  if (v) r = r.replace(/\{(\w+)\}/g, (_, k) => (v[k] ?? ''));
  return r;
}
// singular / plural keys: trn(3, '{n} issue', '{n} issues')
const trn = (n, one, many) => tr(n === 1 ? one : many, { n });
const loc = () => (lang === 'vi' ? 'vi-VN' : 'en-US');

// static text in index.html: <span data-t="English">English</span>
function applyStaticText() {
  document.documentElement.lang = lang;
  document.querySelectorAll('[data-t]').forEach((el) => { el.textContent = tr(el.dataset.t); });
}
