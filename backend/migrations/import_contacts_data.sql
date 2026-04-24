-- Auto-generated from DANH BẠ sheet
-- Run: psql -U erp_user -d erp_db -f import_contacts.sql

INSERT INTO bqms_contacts (email_username, full_name, delivery_info, phone) VALUES ('chu.binh', 'Chu Văn Bình', '1. Bộ phận: Outsourcing Operation P (Mr. Bình_0904591175)
2. Kho MRO: B05-B06
3. Kho nhận: A02~A06 Mr Dương (0967646089)', '0904591175') ON CONFLICT (email_username) DO UPDATE SET full_name = EXCLUDED.full_name, delivery_info = EXCLUDED.delivery_info, phone = EXCLUDED.phone, updated_at = NOW();
INSERT INTO bqms_contacts (email_username, full_name, delivery_info, phone) VALUES ('cong.nghia', 'Dương Công Nghĩa', '1. Bộ phận nhận: Outsourcing PQC P
2. Kho MM và nhận: B08 (Ms. Thúy- 0338406205)', '0373747291') ON CONFLICT (email_username) DO UPDATE SET full_name = EXCLUDED.full_name, delivery_info = EXCLUDED.delivery_info, phone = EXCLUDED.phone, updated_at = NOW();
INSERT INTO bqms_contacts (email_username, full_name, delivery_info, phone) VALUES ('dang.tai', 'Đặng Quang Tài', '1. Bộ phận: SMD G (Mr. Tài_ 0982 518 990)
2. Kho MRO: B05-B06
3. Kho nhận: B08, SDT nhận hàng 0222 369 6627', '0982 518 990') ON CONFLICT (email_username) DO UPDATE SET full_name = EXCLUDED.full_name, delivery_info = EXCLUDED.delivery_info, phone = EXCLUDED.phone, updated_at = NOW();
INSERT INTO bqms_contacts (email_username, full_name, delivery_info, phone) VALUES ('dau.hoang', 'Hoàng Văn Dậu', '1. Bộ phận Automation
2. Kho kí và nhận: B08 (Ms. Xuân- 0325970224 hoặc Ms. Hương- 0985913364)', '0346431134') ON CONFLICT (email_username) DO UPDATE SET full_name = EXCLUDED.full_name, delivery_info = EXCLUDED.delivery_info, phone = EXCLUDED.phone, updated_at = NOW();
INSERT INTO bqms_contacts (email_username, full_name, delivery_info, phone) VALUES ('diem.duc', 'Nguyễn Đức Điểm', '1. Bộ phận: Rb Team
2. Kho MRO: B05-B06
3. kho nhận: J17 (Mr Bộ- 0984374403 hoặc Mr. Tân- 0915038040)', '0385323182') ON CONFLICT (email_username) DO UPDATE SET full_name = EXCLUDED.full_name, delivery_info = EXCLUDED.delivery_info, phone = EXCLUDED.phone, updated_at = NOW();
INSERT INTO bqms_contacts (email_username, full_name, delivery_info, phone) VALUES ('diem.loan', 'Diễm Thị Loan', '1. Bộ phận: Automation (Ms. Loan_ 0374687223)
2. Kho MRO: B05-B06
3. kho nhận: B06-B09 (quay về F04 khi có thông báo mới nhất)', '0374.687.223') ON CONFLICT (email_username) DO UPDATE SET full_name = EXCLUDED.full_name, delivery_info = EXCLUDED.delivery_info, phone = EXCLUDED.phone, updated_at = NOW();
INSERT INTO bqms_contacts (email_username, full_name, delivery_info, phone) VALUES ('do.nguyen', 'Đỗ Bình Nguyên', '1. Bộ phận FTG
2. Kho kí và nhận: B08
3. SDT 0347898097-Nguyên', '0347898097') ON CONFLICT (email_username) DO UPDATE SET full_name = EXCLUDED.full_name, delivery_info = EXCLUDED.delivery_info, phone = EXCLUDED.phone, updated_at = NOW();
INSERT INTO bqms_contacts (email_username, full_name, delivery_info, phone) VALUES ('hai90.quang', 'Trịnh Quang Hải', '1. Bộ phận Automation
2. Kho kí và nhận: B08 (Ms. Xuân- 0325970224 hoặc Ms. Hương- 0985913364)', NULL) ON CONFLICT (email_username) DO UPDATE SET full_name = EXCLUDED.full_name, delivery_info = EXCLUDED.delivery_info, phone = EXCLUDED.phone, updated_at = NOW();
INSERT INTO bqms_contacts (email_username, full_name, delivery_info, phone) VALUES ('huyen.duong1', 'Dương Thị Huyền', '1. Bộ phận FTG G
2. Kho MM và kí nhận tại B08
3. sđt 0941226056', '0941226056') ON CONFLICT (email_username) DO UPDATE SET full_name = EXCLUDED.full_name, delivery_info = EXCLUDED.delivery_info, phone = EXCLUDED.phone, updated_at = NOW();
INSERT INTO bqms_contacts (email_username, full_name, delivery_info, phone) VALUES ('huynh.cuong', 'Tô Huỳnh Cường', '1. Bộ phận: CNC Injection Technical P
2. Kho kí: B08
3. Kho nhận: C12 (Mr. Cường_0979495715)', '0979495715') ON CONFLICT (email_username) DO UPDATE SET full_name = EXCLUDED.full_name, delivery_info = EXCLUDED.delivery_info, phone = EXCLUDED.phone, updated_at = NOW();
INSERT INTO bqms_contacts (email_username, full_name, delivery_info, phone) VALUES ('leha.ng', 'Nguyễn Thị Lê Hà', '1. Bộ phận nhận hàng: CNC Innovation
2. Kho MM: B08, gọi số bạn kí hàng: +84-399-686-445 (ước) hoặc Sơn (+84-974-349-195)
 3. Kho nhận: Dock A11, gọi số điện thoại bàn: 02083577199', '0988378164') ON CONFLICT (email_username) DO UPDATE SET full_name = EXCLUDED.full_name, delivery_info = EXCLUDED.delivery_info, phone = EXCLUDED.phone, updated_at = NOW();
INSERT INTO bqms_contacts (email_username, full_name, delivery_info, phone) VALUES ('loan88.ngt', 'Nguyễn Thị Loan', '1. Bộ phận: CNC Equipment P
2. Kho kí: B08 (Ms. Lan_ sdt 0398570316)
3. Kho nhận: C05( gọi 02083576970)', '0383200266') ON CONFLICT (email_username) DO UPDATE SET full_name = EXCLUDED.full_name, delivery_info = EXCLUDED.delivery_info, phone = EXCLUDED.phone, updated_at = NOW();
INSERT INTO bqms_contacts (email_username, full_name, delivery_info, phone) VALUES ('loi.lt', 'Lê Thị Lợi', '1. Bộ phận: Jig Eng P ( MEG SEV )
2. Kho MRO: B05-B06
3. Kho nhận: D01, tòa nhà component 1 (Mr Vượng nhận)
▪︎Tên người ký hàng & nhận hàng
1. Vũ Thị Mai 0389773211
2. Nguyễn Đức Vượng 0968822890', NULL) ON CONFLICT (email_username) DO UPDATE SET full_name = EXCLUDED.full_name, delivery_info = EXCLUDED.delivery_info, phone = EXCLUDED.phone, updated_at = NOW();
INSERT INTO bqms_contacts (email_username, full_name, delivery_info, phone) VALUES ('minh.tuyen1', 'Dương Minh Tuyền', '1. Bộ phận: CNC Innovation- CNC Team
2. kho kí: B08 (Mr. Ước_ 0399686445)
3. Kho nhận: C19, Kho other jig: 02083577682', '0963947161') ON CONFLICT (email_username) DO UPDATE SET full_name = EXCLUDED.full_name, delivery_info = EXCLUDED.delivery_info, phone = EXCLUDED.phone, updated_at = NOW();
INSERT INTO bqms_contacts (email_username, full_name, delivery_info, phone) VALUES ('quyen95.le', 'Nguyễn Thị Lệ Quyên', '1. Bộ phận: CNC Team (Ms. Quyên _0367664055)
2. Kho kí: B08 , gọi sdt 0367.664.055
3. Kho nhận: C19, gọi sdt 0208.357.6922', '0367.664.055') ON CONFLICT (email_username) DO UPDATE SET full_name = EXCLUDED.full_name, delivery_info = EXCLUDED.delivery_info, phone = EXCLUDED.phone, updated_at = NOW();
INSERT INTO bqms_contacts (email_username, full_name, delivery_info, phone) VALUES ('t_hoa.ng', 'Nguyễn Thị Hòa', '1. Glass EQM P (Ms. Hòa-0973406527)
2. Kí và nhận tại E19 (Com 4_SEVT 2)', '0973406527') ON CONFLICT (email_username) DO UPDATE SET full_name = EXCLUDED.full_name, delivery_info = EXCLUDED.delivery_info, phone = EXCLUDED.phone, updated_at = NOW();
INSERT INTO bqms_contacts (email_username, full_name, delivery_info, phone) VALUES ('thi.chang', 'Nguyễn Thị Chang', '1. Production Support P
2. MM: LK2-> Giao nhận MRO
3. Giao về bộ phận: Mobile 1-> Gầm cầu nối C07-11 
Nhớ nhắc lái xe giúp mình là giao ở gầm cầu nối nhé vì điểm này có cả Dock và gầm cầu nên cần giao đúng điểm nha.
KHo PI: anh Thảo', '0989335040') ON CONFLICT (email_username) DO UPDATE SET full_name = EXCLUDED.full_name, delivery_info = EXCLUDED.delivery_info, phone = EXCLUDED.phone, updated_at = NOW();
INSERT INTO bqms_contacts (email_username, full_name, delivery_info, phone) VALUES ('thithu.hien', 'Phạm Thị Thu Hiền', '1. Bộ phận: Automation 
2. kho kí (MRO): B05- B06
3. Kho nhận: F04 (Ms. Hiền_ 0973714827)', '0973714827') ON CONFLICT (email_username) DO UPDATE SET full_name = EXCLUDED.full_name, delivery_info = EXCLUDED.delivery_info, phone = EXCLUDED.phone, updated_at = NOW();
INSERT INTO bqms_contacts (email_username, full_name, delivery_info, phone) VALUES ('tr.huyen', 'Trần Thị Huyên', '1. Bộ phận: Automation 
2. kho kí (MRO): B05- B06
3. Kho nhận:  F04 (Ms. Huyên- 0985607832)', '0985607832') ON CONFLICT (email_username) DO UPDATE SET full_name = EXCLUDED.full_name, delivery_info = EXCLUDED.delivery_info, phone = EXCLUDED.phone, updated_at = NOW();
INSERT INTO bqms_contacts (email_username, full_name, delivery_info, phone) VALUES ('tt.dung2', 'Trần Thùy Dung', '1. Bộ phận: CNC EQM P
2. Kho kí:B08 (Sđt:0344723862)
3. Kho nhận: C05 (02083576970)', '0344723862') ON CONFLICT (email_username) DO UPDATE SET full_name = EXCLUDED.full_name, delivery_info = EXCLUDED.delivery_info, phone = EXCLUDED.phone, updated_at = NOW();
INSERT INTO bqms_contacts (email_username, full_name, delivery_info, phone) VALUES ('nguyet.tr', 'Trương Thị Nguyệt', '1.Bộ phận: CNC R&D
2. Kho kí và nhận: B08
3 Liên hệ: Trần Đại Ý (0382835553) hoặc  Nguyễn Văn Hùng (0349814318)', '0961991929') ON CONFLICT (email_username) DO UPDATE SET full_name = EXCLUDED.full_name, delivery_info = EXCLUDED.delivery_info, phone = EXCLUDED.phone, updated_at = NOW();
INSERT INTO bqms_contacts (email_username, full_name, delivery_info, phone) VALUES ('tuan.thuy', 'Lý Tuấn Thủy', '1. Bộ phận: SUB G
2. Cổng 7 kho E19 (SEVT 2)-02083576485', '02083576485') ON CONFLICT (email_username) DO UPDATE SET full_name = EXCLUDED.full_name, delivery_info = EXCLUDED.delivery_info, phone = EXCLUDED.phone, updated_at = NOW();
INSERT INTO bqms_contacts (email_username, full_name, delivery_info, phone) VALUES ('vinh93.ngv', 'Nguyễn Văn Vinh', '1. Bộ phận Automation
2. Kho kí và nhận tại B08
3. Gọi Xuân: 0325 970 224', '0911234612') ON CONFLICT (email_username) DO UPDATE SET full_name = EXCLUDED.full_name, delivery_info = EXCLUDED.delivery_info, phone = EXCLUDED.phone, updated_at = NOW();
INSERT INTO bqms_contacts (email_username, full_name, delivery_info, phone) VALUES ('thuong.ngt', 'Nguyễn Thị Thương', '1. Bộ phận: Camera MGT tòa nhà linh kiên 3 camera sev
2. Kho kí: B05-B06
3. Kho nhận: H9 H10 linh kiên 3 camera (mrs Thương _ 0968132732)', '0968132732') ON CONFLICT (email_username) DO UPDATE SET full_name = EXCLUDED.full_name, delivery_info = EXCLUDED.delivery_info, phone = EXCLUDED.phone, updated_at = NOW();
INSERT INTO bqms_contacts (email_username, full_name, delivery_info, phone) VALUES ('hanh.ht2', 'Hoàng Thị Hạnh', '1. Bộ phận MMG, Tòa nhà I 
Liên hệ: Nguyễn Thị Hường- 02223696819', NULL) ON CONFLICT (email_username) DO UPDATE SET full_name = EXCLUDED.full_name, delivery_info = EXCLUDED.delivery_info, phone = EXCLUDED.phone, updated_at = NOW();
INSERT INTO bqms_contacts (email_username, full_name, delivery_info, phone) VALUES ('duy.ho', 'Hồ Khánh Duy', '1. Bộ phận: NC Team
2. Kho kí: B05-B06
3. Dock :J024-J025, Linh kiện 4 (Hồ Khánh Duy -0949068236', '0949068236') ON CONFLICT (email_username) DO UPDATE SET full_name = EXCLUDED.full_name, delivery_info = EXCLUDED.delivery_info, phone = EXCLUDED.phone, updated_at = NOW();
INSERT INTO bqms_contacts (email_username, full_name, delivery_info, phone) VALUES ('duong.nt4', 'Nguyễn Thị Dương', '1. Bộ phận NW Support P
2. kho kí: B05-B06
3. Kho nhận: K16-K17, sđt:0353390668', '0353390668') ON CONFLICT (email_username) DO UPDATE SET full_name = EXCLUDED.full_name, delivery_info = EXCLUDED.delivery_info, phone = EXCLUDED.phone, updated_at = NOW();
INSERT INTO bqms_contacts (email_username, full_name, delivery_info, phone) VALUES ('mai.vt2', 'Vũ Thị Mai', '1. Bộ phận JIG ENG P (MEG SEV)
2. Kho MM, khu vực giao nhận MRO, tòa nhà Component 2
3. Kho nhận: D01, tòa nhà Component 1 (Mr. Vượng: 0968822890)', '0389773211') ON CONFLICT (email_username) DO UPDATE SET full_name = EXCLUDED.full_name, delivery_info = EXCLUDED.delivery_info, phone = EXCLUDED.phone, updated_at = NOW();
INSERT INTO bqms_contacts (email_username, full_name, delivery_info, phone) VALUES ('dung.ntk', 'Nguyễn Thị Kim Dung', '1. Bộ phận : RB
3. Kho MM ( Giao nhận MRO )_ tòa Linh kiện 2
4. Kho nhận ( Sảnh RB )_ tòa linh kiện 4
5. SDT người nhận : 0978.698.018 ( A.Sở )  0912.991.554 ( A.Dân )', '0982618059') ON CONFLICT (email_username) DO UPDATE SET full_name = EXCLUDED.full_name, delivery_info = EXCLUDED.delivery_info, phone = EXCLUDED.phone, updated_at = NOW();
INSERT INTO bqms_contacts (email_username, full_name, delivery_info, phone) VALUES ('thuy89.tt', 'Trần Thị Thúy', '1. Bộ phận: CNC R&D Group
2. Kho kí và nhận: B08 (0365437464- Ms. Thúy)', '0365437464') ON CONFLICT (email_username) DO UPDATE SET full_name = EXCLUDED.full_name, delivery_info = EXCLUDED.delivery_info, phone = EXCLUDED.phone, updated_at = NOW();
INSERT INTO bqms_contacts (email_username, full_name, delivery_info, phone) VALUES ('lien.vtk', 'Vũ Thị Kim Liên', '1. Bộ phận: SUB G (Ms. Hương_ 0982682608)
2. Kho kí MRO: B05-B06
3. Kho nhận: D02-D03', '0988089603') ON CONFLICT (email_username) DO UPDATE SET full_name = EXCLUDED.full_name, delivery_info = EXCLUDED.delivery_info, phone = EXCLUDED.phone, updated_at = NOW();
INSERT INTO bqms_contacts (email_username, full_name, delivery_info, phone) VALUES ('nghuong.thi', 'Nguyễn Thị Hường', '1. MM Group, sđt: 0981913923 (Nguyễn Thị Hường)
2. Kho kí: B05-B06
3. Kho nhận: A06 (Liên hệ: 0223696761/0223696759)', '0981913923') ON CONFLICT (email_username) DO UPDATE SET full_name = EXCLUDED.full_name, delivery_info = EXCLUDED.delivery_info, phone = EXCLUDED.phone, updated_at = NOW();
INSERT INTO bqms_contacts (email_username, full_name, delivery_info, phone) VALUES ('van.thai', 'Đỗ Văn Thái', '1. bộ phận Main G
2. Kho kí : B05-B06
3. Kho nhận: C07 - C11 (Đỗ Văn Thái - 0948666221)', '0948666221') ON CONFLICT (email_username) DO UPDATE SET full_name = EXCLUDED.full_name, delivery_info = EXCLUDED.delivery_info, phone = EXCLUDED.phone, updated_at = NOW();
INSERT INTO bqms_contacts (email_username, full_name, delivery_info, phone) VALUES ('vanyen.ng', 'Nguyễn Văn Yên', '1.Bộ phận : CNC Innovation P 
2. Kho kí: B08 (Mr. Ước_ 0399686445)
3. Kho nhận: C05 (gọi 02083576970)
Nếu là hàng phôi => giao A33', '0967844199') ON CONFLICT (email_username) DO UPDATE SET full_name = EXCLUDED.full_name, delivery_info = EXCLUDED.delivery_info, phone = EXCLUDED.phone, updated_at = NOW();
INSERT INTO bqms_contacts (email_username, full_name, delivery_info, phone) VALUES ('hoang.yen', 'Nguyễn Thị Hoàng Yến', '1. Bộ phận: CNC Team
2. Kho nhận: B08 (Mr. Ước_ 0399686445)
3. Kho nhận: phụ thuộc vào PO', '0333.482.616') ON CONFLICT (email_username) DO UPDATE SET full_name = EXCLUDED.full_name, delivery_info = EXCLUDED.delivery_info, phone = EXCLUDED.phone, updated_at = NOW();
INSERT INTO bqms_contacts (email_username, full_name, delivery_info, phone) VALUES ('hoang92.nh', 'Nguyễn Huy Hoàng', '1. Bộ phận PAD Equipment P
2. Kho kí và nhận: E19-SEVT 2
3. Liên hệ: 02083577908 hoặc 0826325609', '0826325609') ON CONFLICT (email_username) DO UPDATE SET full_name = EXCLUDED.full_name, delivery_info = EXCLUDED.delivery_info, phone = EXCLUDED.phone, updated_at = NOW();
INSERT INTO bqms_contacts (email_username, full_name, delivery_info, phone) VALUES ('trong.sinh', 'Ngô Trọng Sinh', '1-  Người phụ trách: Ngô Trọng Sinh (sđt: 0343943358 - bp: NW-Shipment)
2- Vị trí kho MM: Dock K13-14 tòa nhà K (Network)
3- Vị trí nhận hàng: Dock K09-K12 tòa nhà K (Network)
Thông tin người nhận: Chu Thế Cương (sđt: 0349543509 - bp: NW-Shipment)
Lưu ý: Gửi thông tin người giao hàng -> đăng ký vào 2 Dock (1: K13-14, 2: K09-K12) -> Xe giao hàng vào Dock 13-14 để MM, bộ phận kiểm tra hàng và ký giấy tờ sau đó di chuyển đến K09-K12 để giao hàng cho bộ phận', '0343943358') ON CONFLICT (email_username) DO UPDATE SET full_name = EXCLUDED.full_name, delivery_info = EXCLUDED.delivery_info, phone = EXCLUDED.phone, updated_at = NOW();
INSERT INTO bqms_contacts (email_username, full_name, delivery_info, phone) VALUES ('sontung.ng', 'Nguyễn Sơn Tùng', '1. Bộ phận: MAIN (sdt: 0979899286  -Nguyễn Sơn Tùng)
2. Kho nhận hàng là kho B08 - tòa Com 1', '0979899286') ON CONFLICT (email_username) DO UPDATE SET full_name = EXCLUDED.full_name, delivery_info = EXCLUDED.delivery_info, phone = EXCLUDED.phone, updated_at = NOW();
INSERT INTO bqms_contacts (email_username, full_name, delivery_info, phone) VALUES ('tham92.hoang', 'Hoàng Thị Thắm', '1. Bộ phận MM
2. Kí và nhận tại kho MM, C34 (Ms. Thắm_0978618921)', '0978618921') ON CONFLICT (email_username) DO UPDATE SET full_name = EXCLUDED.full_name, delivery_info = EXCLUDED.delivery_info, phone = EXCLUDED.phone, updated_at = NOW();
INSERT INTO bqms_contacts (email_username, full_name, delivery_info, phone) VALUES ('tam.ntt1', 'Nguyễn Thị Thanh Tâm', '1. Bộ phận: Productinon Support P 
2. Kho kí: B05-B06
3. Kho nhận: Linh kiện 1- D02 -D03 (Ms. Tâm-0982.624.857)', '0982624857') ON CONFLICT (email_username) DO UPDATE SET full_name = EXCLUDED.full_name, delivery_info = EXCLUDED.delivery_info, phone = EXCLUDED.phone, updated_at = NOW();
INSERT INTO bqms_contacts (email_username, full_name, delivery_info, phone) VALUES ('nguyen.vquan', 'Nguyễn Văn Quân', '1. Bộ phận : Camera (sdt 0945838988 -Mr. Quân )
2. Kho kí: B05-B06
3. địa chỉ nhận sảnh Camera. linh kiện 3', '0945838988') ON CONFLICT (email_username) DO UPDATE SET full_name = EXCLUDED.full_name, delivery_info = EXCLUDED.delivery_info, phone = EXCLUDED.phone, updated_at = NOW();
INSERT INTO bqms_contacts (email_username, full_name, delivery_info, phone) VALUES ('men95.hoang', 'Hoàng Thị Mến', '1. Bộ phận: CNC Team
2. Kho nhận: B08 (02083576879)
3. Kho nhận: C21 (02083577682) hoặc C05 (02083576970)
Hàng phôi => nhận A33 (02083576970)', '0967145095 / 02083577476') ON CONFLICT (email_username) DO UPDATE SET full_name = EXCLUDED.full_name, delivery_info = EXCLUDED.delivery_info, phone = EXCLUDED.phone, updated_at = NOW();
INSERT INTO bqms_contacts (email_username, full_name, delivery_info, phone) VALUES ('mtt.huyen', 'Ma Thị Thanh Huyền', '1. Bộ phận: Automation
2. Kho kí và nhận tại B08
3. Gọi Xuân: 0325 970 224', '0364176718') ON CONFLICT (email_username) DO UPDATE SET full_name = EXCLUDED.full_name, delivery_info = EXCLUDED.delivery_info, phone = EXCLUDED.phone, updated_at = NOW();
INSERT INTO bqms_contacts (email_username, full_name, delivery_info, phone) VALUES ('htp.thao1', 'Hoàng Thị Phương Thảo', '1. Bộ phận: Glass Operation G
2. Ký nhận Dock B08_Comp1_SĐT: 0966323158', '0966323158') ON CONFLICT (email_username) DO UPDATE SET full_name = EXCLUDED.full_name, delivery_info = EXCLUDED.delivery_info, phone = EXCLUDED.phone, updated_at = NOW();
INSERT INTO bqms_contacts (email_username, full_name, delivery_info, phone) VALUES ('thao.thach', 'Ngô Thị Thạch Thảo', '1. Bộ phận SMD  (0982104923 - Ms Thảo)
2. Kho kí tại B08
3. Kho nhận: B20', '0982104923') ON CONFLICT (email_username) DO UPDATE SET full_name = EXCLUDED.full_name, delivery_info = EXCLUDED.delivery_info, phone = EXCLUDED.phone, updated_at = NOW();
INSERT INTO bqms_contacts (email_username, full_name, delivery_info, phone) VALUES ('minhhai.tt', 'Trương Thị Minh Hải', '1.Bộ phận : CNC Innovation P 
2. Kho kí: B08 (Mr. Ước_ 0399686445)
3. Kho nhận: C05 (gọi 02083576970)', '0985726589') ON CONFLICT (email_username) DO UPDATE SET full_name = EXCLUDED.full_name, delivery_info = EXCLUDED.delivery_info, phone = EXCLUDED.phone, updated_at = NOW();
INSERT INTO bqms_contacts (email_username, full_name, delivery_info, phone) VALUES ('thuy.trang1', 'Nguyễn Thị Thùy Trang', '1. Bộ phận: SUB
2. Kí và nhận tại Dock D22 tòa linh kiện 4 SEVT 2 (Ms Trang- 0971926898)
Nếu hàng nặng đăng kí thêm dock E10 để hạ hàng', '0971926898') ON CONFLICT (email_username) DO UPDATE SET full_name = EXCLUDED.full_name, delivery_info = EXCLUDED.delivery_info, phone = EXCLUDED.phone, updated_at = NOW();
INSERT INTO bqms_contacts (email_username, full_name, delivery_info, phone) VALUES ('nt.thanh01', 'Nguyễn Thị Thanh', '1. Bộ phận CNC Team 
2. Kho kí tại Tòa D, D18 (Ms. Thanh_ 0834320316)
3. Nhận tại D03. Liên hệ: Trần Văn Sự : +84-375-559-587/ Kho 4G: +84-2083577361

Nếu gửi hàng ở SEVT 1
1. Bộ phận CNC Team
2. Kho kí: B08 (Mr. Ước_ 0399686445)
3. Kho nhận: C21 (02083576922)', '0834320316') ON CONFLICT (email_username) DO UPDATE SET full_name = EXCLUDED.full_name, delivery_info = EXCLUDED.delivery_info, phone = EXCLUDED.phone, updated_at = NOW();
INSERT INTO bqms_contacts (email_username, full_name, delivery_info, phone) VALUES ('nt.dung5', 'Nguyễn Thùy Dung', '1. Bộ phận Production Support P
2. Kho kí tại B08 (Ms. Dung_ 0339617895)
3. Nhận tại Dock A20,tòa Mobile (tòa B20 cũ)', '0339617895') ON CONFLICT (email_username) DO UPDATE SET full_name = EXCLUDED.full_name, delivery_info = EXCLUDED.delivery_info, phone = EXCLUDED.phone, updated_at = NOW();
INSERT INTO bqms_contacts (email_username, full_name, delivery_info, phone) VALUES ('dam.nt1', 'Ngô Thị Đảm', '1. Bộ phận : SMD (sdt 0943819868- anh Tám)
2. Kho kí: B05~B06
3. Kho nhận: D01 (02223696627)', '0359457060') ON CONFLICT (email_username) DO UPDATE SET full_name = EXCLUDED.full_name, delivery_info = EXCLUDED.delivery_info, phone = EXCLUDED.phone, updated_at = NOW();
INSERT INTO bqms_contacts (email_username, full_name, delivery_info, phone) VALUES ('hai.nt12', 'Ngô Thị Hải', '1. Bộ phận: Automation
2. Kho kí tại MRO- B05
3. Kho nhận: F04 (Ms. Hải_0354589091)', '0354589091') ON CONFLICT (email_username) DO UPDATE SET full_name = EXCLUDED.full_name, delivery_info = EXCLUDED.delivery_info, phone = EXCLUDED.phone, updated_at = NOW();
INSERT INTO bqms_contacts (email_username, full_name, delivery_info, phone) VALUES ('vu.lt1', 'Lê Tuấn Vũ', '1. Bộ phận NW 
2. Kho kí: B05~B06
3. Kho nhận: K16-K17, sđt: 0975773193 (Mr. Vũ)', '0975773193') ON CONFLICT (email_username) DO UPDATE SET full_name = EXCLUDED.full_name, delivery_info = EXCLUDED.delivery_info, phone = EXCLUDED.phone, updated_at = NOW();
INSERT INTO bqms_contacts (email_username, full_name, delivery_info, phone) VALUES ('dong.thuy', 'Đồng Thị Thủy', '1. Bộ phận Main
2. Kho kí: MRO (Ms. Thủy_ 0913141090)
3. Kho nhận: Giao cửa c07-c11 (Người nhận: Cường sđt: 0382414868)', '0913141090') ON CONFLICT (email_username) DO UPDATE SET full_name = EXCLUDED.full_name, delivery_info = EXCLUDED.delivery_info, phone = EXCLUDED.phone, updated_at = NOW();
INSERT INTO bqms_contacts (email_username, full_name, delivery_info, phone) VALUES ('duy.thuat', 'Nguyễn Duy Thuật', '1. Bộ phận Department: Outsourcing G
2. Kho MM, thuộc tòa: Com 2 kho nhận MRO (Mr. Thuật_ 0986088793)
3. Kho nhận: A02~A06 (Dương_ 0967646089)', '0986088793') ON CONFLICT (email_username) DO UPDATE SET full_name = EXCLUDED.full_name, delivery_info = EXCLUDED.delivery_info, phone = EXCLUDED.phone, updated_at = NOW();
INSERT INTO bqms_contacts (email_username, full_name, delivery_info, phone) VALUES ('thihue.duong', 'Dương Thị Huệ', '1. Bộ phận: SMD
2. Kho MM: B08 (Ms. Huệ_ 0832090189)
3. Kho kí: Kho B08 hoặc A20 (Gọi xác nhận với Mr.Hiên tại thời điểm giao do đang có thử nghiệm gộp cửa kho) (0973 424 592- Mr.Hiên)', '0832090189') ON CONFLICT (email_username) DO UPDATE SET full_name = EXCLUDED.full_name, delivery_info = EXCLUDED.delivery_info, phone = EXCLUDED.phone, updated_at = NOW();
INSERT INTO bqms_contacts (email_username, full_name, delivery_info, phone) VALUES ('luyen94.hong', 'Trịnh Thị Hồng Luyên', '1. Bộ phận: Outsourcing
2. Kho kí và nhận: B08 (gọi 0387616392)', '0974967923') ON CONFLICT (email_username) DO UPDATE SET full_name = EXCLUDED.full_name, delivery_info = EXCLUDED.delivery_info, phone = EXCLUDED.phone, updated_at = NOW();
INSERT INTO bqms_contacts (email_username, full_name, delivery_info, phone) VALUES ('thiha.nt', 'Nguyễn Thị Hà', '1. Camera (Ms. Hà_0915057605)
2. Kho GR: kho MRO, component 2
3. Nơi nhận: cửa Camera SMD, người nhận: Hiền 0946286983 or Chung 0962997189', '0915057605') ON CONFLICT (email_username) DO UPDATE SET full_name = EXCLUDED.full_name, delivery_info = EXCLUDED.delivery_info, phone = EXCLUDED.phone, updated_at = NOW();
INSERT INTO bqms_contacts (email_username, full_name, delivery_info, phone) VALUES ('t.thao.nt', 'Nguyễn Thị Thảo', '1. Bộ phận: NC Mechanical R&D G
2. Kho MRO: B05~B06
3. Kho nhận: J21~J25 gọi Mr.Phóng  0567866866 hoặc Mr.Tài   0968891053', NULL) ON CONFLICT (email_username) DO UPDATE SET full_name = EXCLUDED.full_name, delivery_info = EXCLUDED.delivery_info, phone = EXCLUDED.phone, updated_at = NOW();
INSERT INTO bqms_contacts (email_username, full_name, delivery_info, phone) VALUES ('anhduc.ph', 'Phạm Anh Đức', '1. Bộ phận: Glass Operation G
2. Kho kí và nhận: B08 (0208 3576440)', NULL) ON CONFLICT (email_username) DO UPDATE SET full_name = EXCLUDED.full_name, delivery_info = EXCLUDED.delivery_info, phone = EXCLUDED.phone, updated_at = NOW();
INSERT INTO bqms_contacts (email_username, full_name, delivery_info, phone) VALUES ('ph.thihuong', 'Phạm Thị Hương', '1. Bộ phận Department: Outsourcing
2. Kho MM: B05~B06
3. Kho nhận: A02~A06 (Dương_ 0967646089)', '0973512957') ON CONFLICT (email_username) DO UPDATE SET full_name = EXCLUDED.full_name, delivery_info = EXCLUDED.delivery_info, phone = EXCLUDED.phone, updated_at = NOW();
INSERT INTO bqms_contacts (email_username, full_name, delivery_info, phone) VALUES ('xuan.y', 'Trịnh Xuân Ý', '1. bộ phận Wearable
2. Kho MM vị trí B05-06
3. Kho nhận D02-03 (Trần Xuân Phượng- 0349614000)', '0982855590') ON CONFLICT (email_username) DO UPDATE SET full_name = EXCLUDED.full_name, delivery_info = EXCLUDED.delivery_info, phone = EXCLUDED.phone, updated_at = NOW();
INSERT INTO bqms_contacts (email_username, full_name, delivery_info, phone) VALUES ('hang.nt2', 'Nguyễn Thị Hằng', '1. Bộ phận: MEG
2. Kho kí: MRO (B05-B06)
3. Kho nhận: D01', NULL) ON CONFLICT (email_username) DO UPDATE SET full_name = EXCLUDED.full_name, delivery_info = EXCLUDED.delivery_info, phone = EXCLUDED.phone, updated_at = NOW();
INSERT INTO bqms_contacts (email_username, full_name, delivery_info, phone) VALUES ('long.nt2', 'Nguyễn Long', '1. Bộ phận: SUB
2. Kho kí: B05-B06
3. Kho nhận: D02-D03 (0359518655)', '0359518655') ON CONFLICT (email_username) DO UPDATE SET full_name = EXCLUDED.full_name, delivery_info = EXCLUDED.delivery_info, phone = EXCLUDED.phone, updated_at = NOW();
INSERT INTO bqms_contacts (email_username, full_name, delivery_info, phone) VALUES ('ngt.hien', 'Nguyễn Thị Hiên', '1. Bộ phận: SMD
2 Kho kí và kho nhận: B08 ( Mr. Thảo - 0934308646 )', NULL) ON CONFLICT (email_username) DO UPDATE SET full_name = EXCLUDED.full_name, delivery_info = EXCLUDED.delivery_info, phone = EXCLUDED.phone, updated_at = NOW();
INSERT INTO bqms_contacts (email_username, full_name, delivery_info, phone) VALUES ('thao.dv1', 'Dương Văn Thảo', '1. Bộ phận: SMD
2 Kho kí và kho nhận: B08 ( Mr. Thảo - 0934308646 )', '0934308646') ON CONFLICT (email_username) DO UPDATE SET full_name = EXCLUDED.full_name, delivery_info = EXCLUDED.delivery_info, phone = EXCLUDED.phone, updated_at = NOW();
INSERT INTO bqms_contacts (email_username, full_name, delivery_info, phone) VALUES ('yen.phan', 'Phan Thị Yến', '1. Bộ phận: FIRE Part
2. Kho kí và nhận: B08 (Ms. Yến- 0973428776)', '0973428776') ON CONFLICT (email_username) DO UPDATE SET full_name = EXCLUDED.full_name, delivery_info = EXCLUDED.delivery_info, phone = EXCLUDED.phone, updated_at = NOW();
INSERT INTO bqms_contacts (email_username, full_name, delivery_info, phone) VALUES ('truong1.nd', 'Nguyễn Đình Trường', '1. bộ phận: Department Outsourcing Operation P
2. Kho kí và nhận thuộc Comp1 Dock B08 SEVT1
3. Người nhận: Ms.Hoan - 0387616392', '0974226068') ON CONFLICT (email_username) DO UPDATE SET full_name = EXCLUDED.full_name, delivery_info = EXCLUDED.delivery_info, phone = EXCLUDED.phone, updated_at = NOW();
INSERT INTO bqms_contacts (email_username, full_name, delivery_info, phone) VALUES ('phamthi.hoa', 'Phạm Thị Hòa', '1. Bộ phận CNC Injection Technical P
2. Kho MM ký hàng: Kho B8, kho giao hàng nhận hàng: C13
3. Sdt nhận: Ms Hòa 0962157519', '0962157519') ON CONFLICT (email_username) DO UPDATE SET full_name = EXCLUDED.full_name, delivery_info = EXCLUDED.delivery_info, phone = EXCLUDED.phone, updated_at = NOW();
INSERT INTO bqms_contacts (email_username, full_name, delivery_info, phone) VALUES ('nt.loan2', 'Nguyễn Thị Loan', '1. Bộ phận: Glass G
2 Kho kí và kho nhận: Com 4. E19 ( Loan - 0396922797)', '0396922797') ON CONFLICT (email_username) DO UPDATE SET full_name = EXCLUDED.full_name, delivery_info = EXCLUDED.delivery_info, phone = EXCLUDED.phone, updated_at = NOW();
INSERT INTO bqms_contacts (email_username, full_name, delivery_info, phone) VALUES ('huong.tt8', 'Tạ Thị Hương', '1. Bộ phận: Wearable Innovation P
2. Kho MRO: B05-B06 (Ms. Hương_ 0384222488)
3. Kho nhận: D01_ MEG / SDT nhận : Trần xuân Phượng :+84-349-614-000  / Nguyen Kim Tien : +84-904-327-765', '0384222488') ON CONFLICT (email_username) DO UPDATE SET full_name = EXCLUDED.full_name, delivery_info = EXCLUDED.delivery_info, phone = EXCLUDED.phone, updated_at = NOW();
INSERT INTO bqms_contacts (email_username, full_name, delivery_info, phone) VALUES ('quyen89.vu', 'Vũ Thị Quyên', '1. Bộ phận: IQC
2. Kho kí và nhận: B08 (Ms. Quyên _ 0339891182)', '0339891182') ON CONFLICT (email_username) DO UPDATE SET full_name = EXCLUDED.full_name, delivery_info = EXCLUDED.delivery_info, phone = EXCLUDED.phone, updated_at = NOW();
INSERT INTO bqms_contacts (email_username, full_name, delivery_info, phone) VALUES ('ngt.thao1', 'Nguyễn Thị Thảo', '1.Bộ phận : CNC Innovation P 
2. Kho kí: B08 (Mr. Ước_ 0399686445)
3. Kho nhận: C05 (gọi 02083576970)
Nếu là hàng phôi => giao A33', '0327156824') ON CONFLICT (email_username) DO UPDATE SET full_name = EXCLUDED.full_name, delivery_info = EXCLUDED.delivery_info, phone = EXCLUDED.phone, updated_at = NOW();
INSERT INTO bqms_contacts (email_username, full_name, delivery_info, phone) VALUES ('ntt.le', 'Nguyễn Thị Tuyết Lê', '1. Bộ phận: Automation
2. kho kí và nhận: B08 (Ms. Hương_0985913364)', '0975988147') ON CONFLICT (email_username) DO UPDATE SET full_name = EXCLUDED.full_name, delivery_info = EXCLUDED.delivery_info, phone = EXCLUDED.phone, updated_at = NOW();
INSERT INTO bqms_contacts (email_username, full_name, delivery_info, phone) VALUES ('dung.dt1', 'Đỗ Thị Dung', '1. Bộ phận: RB Team
2. Kho kí MRO: B05-B06
3. Kho nhận: J03 (Ms. Dung- 0962755833)', '0962755833') ON CONFLICT (email_username) DO UPDATE SET full_name = EXCLUDED.full_name, delivery_info = EXCLUDED.delivery_info, phone = EXCLUDED.phone, updated_at = NOW();
INSERT INTO bqms_contacts (email_username, full_name, delivery_info, phone) VALUES ('thithao91.ph', 'Phạm Thị Thảo', '1. Bộ phận: WS2P
2. Kho MM: B08 (Ms. Thảo_0366921294)
3. Kho nhận: C05 (Mr Thức: 0969728891)', '0366921294') ON CONFLICT (email_username) DO UPDATE SET full_name = EXCLUDED.full_name, delivery_info = EXCLUDED.delivery_info, phone = EXCLUDED.phone, updated_at = NOW();
INSERT INTO bqms_contacts (email_username, full_name, delivery_info, phone) VALUES ('nt.huyen2', 'Nguyễn Thị Huyền', '1. Bộ phận: Production Support P
2. Dock nhận hàng: B08
3. Sđt: 0374524601', '0374524601') ON CONFLICT (email_username) DO UPDATE SET full_name = EXCLUDED.full_name, delivery_info = EXCLUDED.delivery_info, phone = EXCLUDED.phone, updated_at = NOW();
INSERT INTO bqms_contacts (email_username, full_name, delivery_info, phone) VALUES ('quang.vinh91', 'Nguyễn Quang Vinh', '1. Bộ phận: Mold (Mr. Vinh - 0975363112)
2. Kho kí và nhận: D22 (COM3- SEVT 2)', '0975363112') ON CONFLICT (email_username) DO UPDATE SET full_name = EXCLUDED.full_name, delivery_info = EXCLUDED.delivery_info, phone = EXCLUDED.phone, updated_at = NOW();
INSERT INTO bqms_contacts (email_username, full_name, delivery_info, phone) VALUES ('tam.ntt', 'Nguyễn Thanh Tâm', '1. Bộ phận: Automation
2. Kho kí và nhận: B08
Liên hệ: Ms. Tâm - 0986855711 hoăc Ms. Huyền - 0976196572', '0986855711') ON CONFLICT (email_username) DO UPDATE SET full_name = EXCLUDED.full_name, delivery_info = EXCLUDED.delivery_info, phone = EXCLUDED.phone, updated_at = NOW();
INSERT INTO bqms_contacts (email_username, full_name, delivery_info, phone) VALUES ('thuyet93.van', 'Lê Văn Thuyết', '1. Bộ phận: CNC Equipment P
2. Kho kí: B08 (Mr. Ước_ 0399686445)
3. Kho nhận: tùy thuộc vào PO', '0399392692') ON CONFLICT (email_username) DO UPDATE SET full_name = EXCLUDED.full_name, delivery_info = EXCLUDED.delivery_info, phone = EXCLUDED.phone, updated_at = NOW();
INSERT INTO bqms_contacts (email_username, full_name, delivery_info, phone) VALUES ('hl.giang', 'Hoàng Lệ Giang', '1. Bộ phận Automation
2. Kho kí và nhận tại B08
3. Liên hệ: Ms. Xuân_ 0325 970 224 hoặc Ms. Hương_0985913364', '0399189572') ON CONFLICT (email_username) DO UPDATE SET full_name = EXCLUDED.full_name, delivery_info = EXCLUDED.delivery_info, phone = EXCLUDED.phone, updated_at = NOW();
INSERT INTO bqms_contacts (email_username, full_name, delivery_info, phone) VALUES ('ngthi.thao', 'Nguyễn Thị Thảo', '1. Bộ phận: CNC INJECTION G
2. Kho kí: B08 (Ms. Thảo _ 0372561059)
3. Kho nhận: C13 (0399979340)', '0372561059') ON CONFLICT (email_username) DO UPDATE SET full_name = EXCLUDED.full_name, delivery_info = EXCLUDED.delivery_info, phone = EXCLUDED.phone, updated_at = NOW();
INSERT INTO bqms_contacts (email_username, full_name, delivery_info, phone) VALUES ('vt.an1', 'Vũ Thị Ân', '1. Bộ phận: SMD
2. Kho kí MRO: B05-B06
3. Kho nhận: A02-06 (gọi 0222.369.6627)', '0326968067') ON CONFLICT (email_username) DO UPDATE SET full_name = EXCLUDED.full_name, delivery_info = EXCLUDED.delivery_info, phone = EXCLUDED.phone, updated_at = NOW();
INSERT INTO bqms_contacts (email_username, full_name, delivery_info, phone) VALUES ('ngoai.vt1', 'Vũ Thị Ngoại', '1. Bộ phận: RB (R&D)
2. Kho kí MRO: B05-B06
3. Kho nhận: J17 (Mr. Điểu- 0385323182 hoặc Mr. Bộ- 0984374403)', '0977322869') ON CONFLICT (email_username) DO UPDATE SET full_name = EXCLUDED.full_name, delivery_info = EXCLUDED.delivery_info, phone = EXCLUDED.phone, updated_at = NOW();
INSERT INTO bqms_contacts (email_username, full_name, delivery_info, phone) VALUES ('anh00.le', 'Lê Việt Anh', '1. Bộ phận: Glass Operation G
2. Kho kí và nhận: E19 (SEVT 2). Liên hệ Mr. Việt Anh- 0352057587', '0352057587') ON CONFLICT (email_username) DO UPDATE SET full_name = EXCLUDED.full_name, delivery_info = EXCLUDED.delivery_info, phone = EXCLUDED.phone, updated_at = NOW();
INSERT INTO bqms_contacts (email_username, full_name, delivery_info, phone) VALUES ('thu.hang1', 'Nguyễn Thu Hằng', '1. Bộ phận: MM G
2. Kho kí: B08 (Ms. Hằng- 0948066661)
3. Kho nhận: B34 (Ms. Hằng- 0948066661)', '0948066661') ON CONFLICT (email_username) DO UPDATE SET full_name = EXCLUDED.full_name, delivery_info = EXCLUDED.delivery_info, phone = EXCLUDED.phone, updated_at = NOW();
INSERT INTO bqms_contacts (email_username, full_name, delivery_info, phone) VALUES ('dtt.huyen', 'Đào Thị Thanh Huyền', '1. Bộ phận: CNC Innovation P
2. Kho kí: D18~ D22 (Ms. Huyền- 0392218393)
3. Kho nhận: D03~D09 (gọi 02083577361)', '0392218393') ON CONFLICT (email_username) DO UPDATE SET full_name = EXCLUDED.full_name, delivery_info = EXCLUDED.delivery_info, phone = EXCLUDED.phone, updated_at = NOW();
INSERT INTO bqms_contacts (email_username, full_name, delivery_info, phone) VALUES ('nguyen.hoai.an', 'Nguyễn Thị Hoài An', '1. Bộ phận: SMD G
2. Kho kí và nhận: B08 (Ms. An- 0364647725)', '0364647725') ON CONFLICT (email_username) DO UPDATE SET full_name = EXCLUDED.full_name, delivery_info = EXCLUDED.delivery_info, phone = EXCLUDED.phone, updated_at = NOW();
INSERT INTO bqms_contacts (email_username, full_name, delivery_info, phone) VALUES ('levan.luong', 'Lê Văn Lượng', '1. Bộ phận: Mecha Analysis P
2. Dock kí và nhận: B08 (Mr. Lượng - 0375515826)', '0375515826') ON CONFLICT (email_username) DO UPDATE SET full_name = EXCLUDED.full_name, delivery_info = EXCLUDED.delivery_info, phone = EXCLUDED.phone, updated_at = NOW();
INSERT INTO bqms_contacts (email_username, full_name, delivery_info, phone) VALUES ('ngviet.xuan', 'Nguyễn Viết Xuân', '1. Bộ phận: MEG
2.Kho kí và nhận: B08 (Ms. Vân- 0989743085)', '0977625924') ON CONFLICT (email_username) DO UPDATE SET full_name = EXCLUDED.full_name, delivery_info = EXCLUDED.delivery_info, phone = EXCLUDED.phone, updated_at = NOW();
INSERT INTO bqms_contacts (email_username, full_name, delivery_info, phone) VALUES ('hanh.tran', 'Trần Thị Hạnh', '1. Bộ phận: Camera
2. Kho kí (MRO): B05-B06
3. Kho nhận: Sảnh Camera, tòa H (linh kiện 3), Sđt: 0365-307-889', '0365307889') ON CONFLICT (email_username) DO UPDATE SET full_name = EXCLUDED.full_name, delivery_info = EXCLUDED.delivery_info, phone = EXCLUDED.phone, updated_at = NOW();
INSERT INTO bqms_contacts (email_username, full_name, delivery_info, phone) VALUES ('ph.thang', 'Phan Hùng Thắng', '1. Bộ phận: CNC INNOVATION P
2. Kho kí: B08 (Mr. Ước_ 0399686445)
3. Kho nhận: C21 (SDT: 02083576922)', '0365656357') ON CONFLICT (email_username) DO UPDATE SET full_name = EXCLUDED.full_name, delivery_info = EXCLUDED.delivery_info, phone = EXCLUDED.phone, updated_at = NOW();
INSERT INTO bqms_contacts (email_username, full_name, delivery_info, phone) VALUES ('duc.dang.hd', 'Hoàng Đăng Đức', '1. Bộ phận: GLASS OPERATION P
2. Kho kí và nhận: tùy thuộc vào PO
- Nếu nhận hàng ở SEVT 1: B08 (Ms. Thảo-0966323158)
- Nếu nhận hàng ở SEVT 2:
Kho kí: D22
Kho nhận: E15 (Ms. Lan- 0974528228)', '0979112620') ON CONFLICT (email_username) DO UPDATE SET full_name = EXCLUDED.full_name, delivery_info = EXCLUDED.delivery_info, phone = EXCLUDED.phone, updated_at = NOW();
INSERT INTO bqms_contacts (email_username, full_name, delivery_info, phone) VALUES ('np.thuy', 'Nguyễn Phương Thúy', '1. Bộ phận: CNC Innovation P
2. Kho kí: B08 (Mr. Ước_ 0399686445)
3. Kho nhận (tùy thuộc vào PO)', '0943961182') ON CONFLICT (email_username) DO UPDATE SET full_name = EXCLUDED.full_name, delivery_info = EXCLUDED.delivery_info, phone = EXCLUDED.phone, updated_at = NOW();
INSERT INTO bqms_contacts (email_username, full_name, delivery_info, phone) VALUES ('ngthi.thuy', 'Nguyễn Thị Thùy', '1. Bộ phận: Outsourcing operation P
2. Kho kí và nhận: B08 (Ms. Thúy- 0338406205)', '0978422635') ON CONFLICT (email_username) DO UPDATE SET full_name = EXCLUDED.full_name, delivery_info = EXCLUDED.delivery_info, phone = EXCLUDED.phone, updated_at = NOW();
INSERT INTO bqms_contacts (email_username, full_name, delivery_info, phone) VALUES ('t.nhung', 'Trần Hồng Nhung', '1. Bộ phận: CNC INNOVATION
2. Kho kí: B08 (Mr. Ước_ 0399686445)
3. Kho nhận: tùy thuộc vào PO', NULL) ON CONFLICT (email_username) DO UPDATE SET full_name = EXCLUDED.full_name, delivery_info = EXCLUDED.delivery_info, phone = EXCLUDED.phone, updated_at = NOW();
INSERT INTO bqms_contacts (email_username, full_name, delivery_info, phone) VALUES ('vu.thingoc', 'Vũ Thị Ngọc', '1. Bộ phận: CNC Injection Technical P
2. Kho kí: B08 (Ms. Ngọc_0399979340)
3. Kho nhận: C16 (Ms. Ngọc_0399979340)', '0399979340') ON CONFLICT (email_username) DO UPDATE SET full_name = EXCLUDED.full_name, delivery_info = EXCLUDED.delivery_info, phone = EXCLUDED.phone, updated_at = NOW();
INSERT INTO bqms_contacts (email_username, full_name, delivery_info, phone) VALUES ('bui.thu2', 'Bùi Thị Thư', '1. Bộ phận: Wearable Equipment P
2. Kho kí nhận: B06-B09
3. Người nhận : Trần Xuân Phượng ,sdt : 0349614000', '0982140006') ON CONFLICT (email_username) DO UPDATE SET full_name = EXCLUDED.full_name, delivery_info = EXCLUDED.delivery_info, phone = EXCLUDED.phone, updated_at = NOW();