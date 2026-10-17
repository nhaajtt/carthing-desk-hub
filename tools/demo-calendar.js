// Sample events for the README Calendar screenshot (the real calendar is private). Run in the kiosk page:
// the live stream is paused first so the next update does not replace them; reload the page afterwards.
(() => {
  es.close();
  const t = now(), H = 3600000;
  const at = (dayOff, h, m = 0) => {
    const k = dayKey(t + dayOff * 86400000);
    const guess = Date.parse(k + 'T00:00:00Z');
    const off = new Date(guess).toLocaleString('en-US', { timeZone: tz(), hour12: false, hour: '2-digit' });
    return guess + (24 - Number(off)) % 24 * H + h * H + m * 60000;
  };
  const ev = (d, h, m, len, title, location = '', cal = 0, allDay = false) => ({ id: title + d + h, title, location, start: allDay ? at(d, 0) : at(d, h, m), end: allDay ? at(d + 1, 0) : at(d, h, m) + len * 60000, allDay, cal });
  S.calendar = { configured: true, at: Date.now(), events: [
    ev(0, 0, 0, 0, 'Farmers market', '', 2, true),
    ev(0, 13, 0, 60, 'Lunch with Minh', 'Phở Ha Noi, Santana Row', 0),
    ev(0, 15, 30, 45, 'Car Thing hub: review', '', 1),
    ev(0, 18, 0, 90, 'Gym', 'YMCA', 2),
    ev(0, 20, 30, 30, 'Call mom', '', 3),
    ev(1, 9, 0, 30, 'Standup', 'Zoom', 1),
    ev(1, 11, 0, 60, 'Dentist', 'Willow Glen', 0),
    ev(2, 19, 0, 120, 'Movie night', '', 3),
    ev(4, 8, 0, 60, 'Flight to Seattle', 'SJC Terminal B', 0),
  ].sort((a, b) => a.start - b.start) };
  renderCalendar();
  return S.calendar.events.length;
})()
