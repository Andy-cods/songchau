# OneDrive → VPS Continuous Sync (chạy trên máy local của Thang)

Tự động đồng bộ folder OneDrive trên máy của anh lên VPS Song Chau ERP **mỗi 2 phút**.
Chạy nền, restart khi crash, log vào `%LOCALAPPDATA%\SongChauOneDriveSync\sync.log`.

## Cài 1 lần

Mở PowerShell (không cần admin) chạy:

```powershell
cd "c:\Users\ASUS\OneDrive\Documents\hệ thống song châu\songchau-erp"
powershell -ExecutionPolicy Bypass -File scripts\windows\install_onedrive_watcher.ps1
```

Script sẽ:
1. Kiểm tra Python 3 (cần cài từ python.org nếu chưa có)
2. `pip install paramiko --user`
3. Tạo Windows Scheduled Task `SongChauOneDriveSync`
4. Chạy thử ngay 1 lần

## Theo dõi sống

```powershell
Get-Content "$env:LOCALAPPDATA\SongChauOneDriveSync\sync.log" -Wait -Tail 50
```

## Folder nào được sync

Mặc định trong `onedrive_continuous_sync.py`:

```
Puplic/BQMS, Puplic/BG, Puplic/IMV, Puplic/000. MẪU PO,
Puplic/AMA Quotation, Puplic/YÊU CẦU BÁO GIÁ,
TỔNG HỢP, Attachments
```

Đổi bằng env var `SC_WATCHED_FOLDERS` (mỗi dòng 1 folder), ví dụ trong PowerShell:

```powershell
[Environment]::SetEnvironmentVariable('SC_WATCHED_FOLDERS', "Puplic/BQMS`nTỔNG HỢP", 'User')
# logout/login để env có hiệu lực
```

## Cách hoạt động

1. Đọc state file `%LOCALAPPDATA%\SongChauOneDriveSync\state.json` (size + mtime của từng file lần sync trước)
2. Walk các folder OneDrive local → so sánh với state → diff thành (added/changed/removed)
3. SFTP push **chỉ những file đổi** lên `/data/onedrive-staging/...`
4. Xóa file đã xóa local khỏi VPS
5. Ping `https://erp.songchau.vn/api/v1/etl/sync-local` để VPS rescan ngay → chip "Đồng bộ vừa xong" trên ERP cập nhật trong vòng 30s

## Skip rules

- File `~$*`, `desktop.ini`, `Thumbs.db`, `.DS_Store`
- Extension `.tmp`, `.lnk`, `.crdownload`
- File >200MB

## Gỡ cài

```powershell
schtasks /Delete /TN "SongChauOneDriveSync" /F
```

## Chạy thử 1 lần (không cần task scheduler)

```powershell
cd "c:\Users\ASUS\OneDrive\Documents\hệ thống song châu\songchau-erp"
python scripts\windows\onedrive_continuous_sync.py        # 1 pass rồi exit
python scripts\windows\onedrive_continuous_sync.py --watch  # loop forever
```
