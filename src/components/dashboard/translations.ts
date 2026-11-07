export type Language = "th" | "en";

export interface Translations {
  subtitle: string;
  offline: string;
  connect: string;
  disconnect: string;
  connected: string;
  connecting: string;
  cameraActive: string;
  camera: string;
  noSignal: string;
  cameraWait: string;
  ai: string;
  trash: string;
  oil: string;
  objects: string;
  areas: string;
  details: string;
  notFound: string;
  confidence: string;
  logs: string;
  log1: string;
  log2: string;
  log3: string;
  log4: string;
  mode: string;
  operationAndMovement: string;
  auto: string;
  manual: string;
  autoTitle: string;
  autoDesc: string;
  awaiting: string;
  movement: string;
  padNote: string;
  autoActiveNote: string;
  manualActiveNote: string;
  forward: string;
  backward: string;
  left: string;
  right: string;
  stopMove: string;
  estop: string;
  reset: string;
  estopNote: string;
  trashSys: string;
  motor: string;
  collected: string;
  start: string;
  stop: string;
  autoTrash: string;
  oilSys: string;
  rotation: string;
  arm: string;
  raise: string;
  lower: string;
  up: string;
  down: string;
  idle: string;
  oilPushNote: string;
  autoOil: string;
  footerCopy: string;
  footerDev: string;
  mockNotice: string;
  clearLog: string;
  clearLogTitle: string;
  clearAll: string;
  clearBefore5m: string;
  clearBefore1h: string;
  clearCustom: string;
  clearRange: string;
  rangeFrom: string;
  rangeTo: string;
  clearConfirm: string;
  clearConfirmRange: string;
  clearCancel: string;
  clearBeforeLabel: string;
  autoNavSearching: string;
  autoNavAlignLeft: string;
  autoNavAlignRight: string;
  autoNavForward: string;
  autoNavCollecting: string;
  autoNavReversing: string;
  autoNavStabilizing: string;
  autoNavActive: string;
  collectedCountLabel: string;
  boardIpLabel: string;
  wifiSsidLabel: string;
  wifiPasswordLabel: string;
  wifiPasswordOptional: string;
  wifiSetup: string;
  wifiSetupBusy: string;
  wifiUsbHint: string;
  wifiOpenNetwork: string;
  boardNoResponse: string;
  boardNotFoundWifi: string;
  wifiSetupOk: string;
  mobileLanHint: string;
}

export const strings: Record<Language, Translations> = {
  th: {
    subtitle: "ระบบควบคุมเรือหุ่นยนต์อัตโนมัติ",
    offline: "ไม่ได้เชื่อมต่อ",
    connect: "เชื่อมต่อ",
    disconnect: "ตัดการเชื่อมต่อ",
    connected: "เชื่อมต่อแล้ว",
    connecting: "กำลังเชื่อมต่อ...",
    cameraActive: "เปิดกล้องแล้ว (720p)",
    camera: "กล้องและระบบตรวจจับ AI",
    noSignal: "ไม่มีสัญญาณภาพจากกล้อง",
    cameraWait: "กรุณากดเชื่อมต่อ Arduino UNO Q เพื่อเปิดกล้อง",
    ai: "ผลการตรวจจับด้วย AI",
    trash: "ขยะ",
    oil: "คราบน้ำมัน",
    objects: "วัตถุที่ตรวจพบ",
    areas: "จุดที่ตรวจพบ",
    details: "รายละเอียดการตรวจจับ",
    notFound: "ยังไม่พบวัตถุ",
    confidence: "ค่าความมั่นใจ : --%",
    logs: "บันทึกการทำงาน",
    log1: "[SYSTEM] Dashboard เริ่มต้นพร้อมทำงาน",
    log2: "[INFO] รอการเชื่อมต่อ Arduino UNO Q",
    log3: "[INFO] กล้อง Logitech C270 รอการเปิดผ่านเบราว์เซอร์",
    log4: "[STATUS] ระบบควบคุมและกลไกพร้อมรับคำสั่ง",
    mode: "โหมดการทำงาน",
    operationAndMovement: "โหมดการทำงานและควบคุมการเคลื่อนที่",
    auto: "อัตโนมัติ",
    manual: "บังคับด้วยมือ",
    autoTitle: "ระบบนำทางอัตโนมัติ",
    autoDesc:
      "ระบบจะควบคุมการเคลื่อนที่และกลไกเก็บขยะ/น้ำมันเอง เมื่อเชื่อมต่อจริงและผ่านการทดสอบ",
    awaiting: "รอการเชื่อมต่อ",
    movement: "ควบคุมการเคลื่อนที่",
    padNote: "กดค้างเพื่อเคลื่อนที่ • ปล่อยเพื่อหยุดทันที (ระบบ Dead-man)",
    autoActiveNote: "โหมดอัตโนมัติทำงานอยู่ • กดปุ่ม 'อัตโนมัติ' ตรงกลางเพื่อสลับเป็นโหมดบังคับมือ",
    manualActiveNote: "โหมดบังคับมือ : กดค้างเพื่อเคลื่อนที่ • ปล่อยเพื่อหยุดทันที (ระบบ Dead-man)",
    forward: "หน้า",
    backward: "หลัง",
    left: "ซ้าย",
    right: "ขวา",
    stopMove: "หยุด",
    estop: "⛔ หยุดฉุกเฉิน",
    reset: "↻ ปลดล็อกระบบ",
    estopNote: "ปุ่มหยุดการทำงานฉุกเฉิน (E-STOP) ของหุ่นยนต์",
    trashSys: "ระบบเก็บขยะ",
    motor: "สถานะมอเตอร์",
    collected: "เก็บแล้ว : 0",
    start: "หมุน",
    stop: "หยุด",
    autoTrash: "ผลตรวจจับขยะยังไม่สั่งกลไกเก็บขยะอัตโนมัติ",
    oilSys: "ระบบฉีดพ่นกำจัดน้ำมัน",
    rotation: "การหมุนกลไกเก็บน้ำมัน",
    arm: "ตำแหน่งแขนเก็บน้ำมัน",
    raise: "ขึ้น",
    lower: "ลง",
    up: "ขึ้น",
    down: "ลง",
    idle: "หยุด",
    oilPushNote: "กดค้างที่ปุ่มขึ้น/ลงเพื่อปรับระดับแขนกล • ปล่อยเพื่อหยุด",
    autoOil:
      "เมื่อเข้าสู่ขั้นตอนเก็บน้ำมัน ระบบจะลดแขน หมุนเก็บน้ำมัน หยุดหมุน และยกแขนขึ้นอัตโนมัติ",
    footerCopy: "© 2026 RIBO-TH. All Rights Reserved.",
    footerDev: "Developed by K. Phiraphatz",
    mockNotice: "ระบบควบคุมจริง — พร้อมเชื่อมต่อฮาร์ดแวร์",
    clearLog: "ล้างประวัติ",
    clearLogTitle: "ล้างประวัติการทำงานตามวันและเวลา",
    clearAll: "ทั้งหมด",
    clearBefore5m: "5 นาทีที่ผ่านมา",
    clearBefore1h: "1 ชั่วโมงที่ผ่านมา",
    clearCustom: "ก่อนเวลาที่กำหนด",
    clearRange: "กำหนดช่วงเวลา",
    rangeFrom: "ตั้งแต่ : ",
    rangeTo: "ถึง : ",
    clearConfirm: "ยืนยันการล้างประวัติ",
    clearConfirmRange: "ยืนยันการล้างตามช่วงเวลา",
    clearCancel: "ยกเลิก",
    clearBeforeLabel: "ล้างประวัติก่อนเวลา : ",
    autoNavSearching: "กำลังค้นหาขยะในระยะกล้อง...",
    autoNavAlignLeft: "เลี้ยวซ้ายตั้งศูนย์ขยะ",
    autoNavAlignRight: "เลี้ยวขวาตั้งศูนย์ขยะ",
    autoNavForward: "ขยะอยู่ตรงกลาง — เดินหน้าเก็บขยะ",
    autoNavCollecting: "เข้าสู่ระยะเก็บ — กำลังกวาดเก็บขยะเข้าช่องเก็บ...",
    autoNavReversing: "เก็บสำเร็จ! กำลังถอยหลังตั้งศูนย์เพื่อล็อกขยะชิ้นใหม่...",
    autoNavStabilizing: "หยุดนิ่งเพื่อปรับมุมมองและล็อกขยะชิ้นใหม่...",
    autoNavActive: "ระบบนำทางอัตโนมัติ : ทำงาน",
    collectedCountLabel: "เก็บสำเร็จ : ",
    boardIpLabel: "IP บอร์ด (Wi-Fi)",
    wifiSsidLabel: "ชื่อ Wi-Fi",
    wifiPasswordLabel: "รหัส Wi-Fi",
    wifiPasswordOptional: "เว้นว่างถ้าเครือข่ายเปิด",
    wifiSetup: "ตั้ง Wi-Fi บนบอร์ด",
    wifiSetupBusy: "กำลังตั้ง Wi-Fi...",
    wifiUsbHint: "ไม่ต้องต่อสาย USB — ใช้ Wi-Fi กับบอร์ดได้",
    wifiOpenNetwork: "เครือข่ายเปิด : ไม่ต้องใส่รหัส Wi-Fi",
    boardNoResponse: "บอร์ดไม่ตอบที่ {ip} : กดเชื่อมต่อใหม่",
    boardNotFoundWifi: "ไม่พบบอร์ดบน Wi-Fi นี้ : กดเชื่อมต่อใหม่",
    wifiSetupOk: "ตั้ง Wi-Fi บนบอร์ดแล้ว — ให้ Mac อยู่ Wi-Fi เดียวกัน แล้วกดเชื่อมต่อ",
    mobileLanHint:
      "มือถือต้องอยู่ Wi-Fi เดียวกับบอร์ด — ใส่ IP บอร์ดแล้วกดเชื่อมต่อ หรือเปิดเว็บบนบอร์ดโดยตรง",
  },
  en: {
    subtitle: "Autonomous Robot Control System",
    offline: "Disconnected",
    connect: "Connect",
    disconnect: "Disconnect",
    connected: "Connected",
    connecting: "Connecting...",
    cameraActive: "Camera Active (720p)",
    camera: "Camera & AI Vision",
    noSignal: "No Camera Signal",
    cameraWait: "Connect Arduino UNO Q to activate camera",
    ai: "AI Detection Results",
    trash: "Trash",
    oil: "Oil Spill",
    objects: "Objects Detected",
    areas: "Spots Detected",
    details: "Detection Details",
    notFound: "No Objects Detected",
    confidence: "Confidence Score : --%",
    logs: "System Activity Log",
    log1: "[SYSTEM] Dashboard initialized and ready",
    log2: "[INFO] Awaiting Arduino UNO Q connection",
    log3: "[INFO] Logitech C270 awaiting browser camera access",
    log4: "[STATUS] Movement and collection controls ready",
    mode: "Operation Mode",
    operationAndMovement: "Operation Mode & Movement Control",
    auto: "Auto",
    manual: "Manual",
    autoTitle: "Autonomous Navigation",
    autoDesc:
      "The robot will control navigation and both collection systems after connection and safety testing",
    awaiting: "Awaiting Connection",
    movement: "Movement Control",
    padNote: "Hold to move • Release to stop (Dead-man control)",
    autoActiveNote: "Autonomous mode active • Tap center 'Auto' to switch to manual control",
    manualActiveNote: "Manual mode : Hold to move • Release to stop (Dead-man control)",
    forward: "Fwd",
    backward: "Rev",
    left: "Left",
    right: "Right",
    stopMove: "Stop",
    estop: "⛔ Emergency Stop",
    reset: "↻ Reset System",
    estopNote: "Robot Emergency Stop (E-STOP) System",
    trashSys: "Trash Collection System",
    motor: "Motor Status",
    collected: "Collected : 0",
    start: "Rotate",
    stop: "Stop",
    autoTrash: "Trash detection does not yet command trash collection",
    oilSys: "Oil Elimination Spray System",
    rotation: "Oil Collector Rotation",
    arm: "Oil Collection Arm Position",
    raise: "Up",
    lower: "Down",
    up: "Up",
    down: "Down",
    idle: "Stop",
    oilPushNote: "Hold Up/Down to adjust arm position • Release to stop",
    autoOil:
      "During oil collection, the system will lower the arm, rotate the collector, stop rotation and raise the arm automatically",
    footerCopy: "© 2026 RIBO-TH. All Rights Reserved.",
    footerDev: "Developed by K. Phiraphatz",
    mockNotice: "Real Control System — Ready for Hardware Connection",
    clearLog: "Clear History",
    clearLogTitle: "Clear Activity History by Date & Time",
    clearAll: "All",
    clearBefore5m: "Past 5 Minutes",
    clearBefore1h: "Past 1 Hour",
    clearCustom: "Before Specific Time",
    clearRange: "Date & Time Range",
    rangeFrom: "From : ",
    rangeTo: "To : ",
    clearConfirm: "Confirm Clear History",
    clearConfirmRange: "Confirm Clear in Range",
    clearCancel: "Cancel",
    clearBeforeLabel: "Clear records prior to : ",
    autoNavSearching: "Searching for trash in camera view...",
    autoNavAlignLeft: "Aligning left to center target",
    autoNavAlignRight: "Aligning right to center target",
    autoNavForward: "Target centered — Moving forward to collect",
    autoNavCollecting: "Intake reached — Ingesting trash...",
    autoNavReversing: "Collected! Reversing to acquire next target...",
    autoNavStabilizing: "Stabilizing camera to lock next target...",
    autoNavActive: "Autonomous Nav : Active",
    collectedCountLabel: "Collected : ",
    boardIpLabel: "Board IP (Wi-Fi)",
    wifiSsidLabel: "Wi-Fi name",
    wifiPasswordLabel: "Wi-Fi password",
    wifiPasswordOptional: "Leave empty for open networks",
    wifiSetup: "Set board Wi-Fi",
    wifiSetupBusy: "Configuring Wi-Fi...",
    wifiUsbHint: "No USB cable — use Wi-Fi to reach the board",
    wifiOpenNetwork: "Open network: no Wi-Fi password",
    boardNoResponse: "Board not responding at {ip} — press Connect again",
    boardNotFoundWifi: "No board on this Wi-Fi — press Connect again",
    wifiSetupOk: "Board Wi-Fi updated — join the same Wi-Fi on your Mac, then Connect",
    mobileLanHint:
      "Phone must use the same Wi-Fi as the board — enter the board IP and connect, or open the board URL directly",
  },
};
