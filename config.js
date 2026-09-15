// =============================================================
//  Sổ chi tiêu gia đình - CẤU HÌNH
// =============================================================
//
//  QUY ƯỚC: mỗi lần sửa app, tăng APP_VERSION thêm 1 ở 2 số cuối
//  (1.05 -> 1.06 ...) và đổi CACHE_NAME trong sw.js cho khớp.
//
const CONFIG = {
  APP_NAME: "Sổ chi tiêu gia đình",
  APP_VERSION: "1.11",

  // Dán OAuth Client ID dạng "xxxx.apps.googleusercontent.com" vào đây.
  // Lấy ở đâu: chuỗi bạn đã dán vào ô "Client ID" của app bản trước
  // (hoặc Google Cloud Console > Google Auth Platform > Clients).
  // Nhớ khai https://tungtranabm.github.io trong Authorized JavaScript
  // origins của client đó.
  // Để trống thì app tạm dùng Client ID đã lưu trên máy từ bản trước,
  // nhưng máy mới sẽ không đăng nhập được cho tới khi điền vào đây.
  CLIENT_ID: "1026702565139-sb60801oe2um2jrngs67k2qqqg0q2218.apps.googleusercontent.com",

  // Tên file Google Sheets app tự tạo / tự tìm lại trong Drive.
  // Giữ đúng tên này để app nhận lại file dữ liệu đã có sẵn.
  SPREADSHEET_NAME: "Chi tieu gia dinh - du lieu",

  // spreadsheets: đọc/ghi nội dung file
  // drive.file  : chỉ thấy đúng file do app này tạo, không đụng file khác
  SCOPES: [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive.file",
  ].join(" "),
};
