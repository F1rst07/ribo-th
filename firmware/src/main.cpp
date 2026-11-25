#include <Arduino.h>
#include <Arduino_RouterBridge.h>

// High level: HIGH = ติด, LOW = ดับ
// สายแดง = ไปหน้า, สายดำ = ถอย
// เลี้ยวซ้าย/ขวา = สปิน คนละทาง
// ห้ามเปิดแดงกับดำของมอเตอร์ตัวเดียวกันพร้อมกัน
int rightRed = 12;    // D12 IN1 มอเตอร์ขวา
int rightBlack = 11;  // D11 IN2 มอเตอร์ขวา
int leftRed = 10;     // D10 IN3 มอเตอร์ซ้าย
int leftBlack = 9;    // D9  IN4 มอเตอร์ซ้าย
int pumpPin = 8;      // D8 ปั๊มน้ำ เปิด/ปิด

int estop = 0;

// GPS u-blox NEO-6M on D0 (RX) / D1 (TX) via Serial1 (9600 baud)
String nmeaLine = "";
String lastRawSentence = "";
unsigned long gpsByteCount = 0;
unsigned long gpsSentenceCount = 0;
double latestLat = 0.0;
double latestLon = 0.0;
int satelliteCount = 0;
bool hasGpsFix = false;
unsigned long lastGpsReportMs = 0;

double nmeaToDecimal(const String &coord, const String &hemi) {
  if (coord.length() < 4) return 0.0;
  double raw = coord.toDouble();
  int degrees = (int)(raw / 100.0);
  double minutes = raw - (degrees * 100.0);
  double dec = degrees + (minutes / 60.0);
  if (hemi == "S" || hemi == "W") {
    dec = -dec;
  }
  return dec;
}

void parseNmeaLine(const String &line) {
  if (!line.startsWith("$")) return;
  gpsSentenceCount++;
  lastRawSentence = line;

  bool isRmc = line.startsWith("$GPRMC,") || line.startsWith("$GNRMC,");
  bool isGga = line.startsWith("$GPGGA,") || line.startsWith("$GNGGA,");
  if (!isRmc && !isGga) return;

  String fields[14];
  int fieldIdx = 0;
  int start = 0;
  int len = line.length();
  for (int i = 0; i < len && fieldIdx < 14; i++) {
    char c = line.charAt(i);
    if (c == ',' || c == '*') {
      fields[fieldIdx++] = line.substring(start, i);
      start = i + 1;
      if (c == '*') break;
    }
  }
  if (start < len && fieldIdx < 14) {
    fields[fieldIdx++] = line.substring(start);
  }

  if (isRmc && fieldIdx >= 7) {
    if (fields[2] == "A" && fields[3].length() > 0 && fields[5].length() > 0) {
      double lat = nmeaToDecimal(fields[3], fields[4]);
      double lon = nmeaToDecimal(fields[5], fields[6]);
      if (lat != 0.0 && lon != 0.0) {
        latestLat = lat;
        latestLon = lon;
        hasGpsFix = true;
      }
    } else if (fields[2] == "V") {
      // Void / No Fix yet
    }
  } else if (isGga && fieldIdx >= 8) {
    int fixQuality = fields[6].toInt();
    satelliteCount = fields[7].toInt();
    if (fixQuality > 0 && fields[2].length() > 0 && fields[4].length() > 0) {
      double lat = nmeaToDecimal(fields[2], fields[3]);
      double lon = nmeaToDecimal(fields[4], fields[5]);
      if (lat != 0.0 && lon != 0.0) {
        latestLat = lat;
        latestLon = lon;
        hasGpsFix = true;
      }
    }
  }
}

void motorsOff() {
  digitalWrite(rightRed, LOW);
  digitalWrite(rightBlack, LOW);
  digitalWrite(leftRed, LOW);
  digitalWrite(leftBlack, LOW);
}

void pumpOff() {
  digitalWrite(pumpPin, LOW);
}

void goForward() {
  motorsOff();
  if (estop == 0) {
    digitalWrite(rightRed, HIGH);
    digitalWrite(leftRed, HIGH);
  }
}

void goBack() {
  motorsOff();
  if (estop == 0) {
    digitalWrite(rightBlack, HIGH);
    digitalWrite(leftBlack, HIGH);
  }
}

void spinLeft() {
  motorsOff();
  if (estop == 0) {
    digitalWrite(rightRed, HIGH);
    digitalWrite(leftBlack, HIGH);
  }
}

void spinRight() {
  motorsOff();
  if (estop == 0) {
    digitalWrite(rightBlack, HIGH);
    digitalWrite(leftRed, HIGH);
  }
}

void pumpStart() {
  if (estop == 1) {
    pumpOff();
  } else {
    digitalWrite(pumpPin, HIGH);
  }
}

void stopAll() {
  estop = 1;
  motorsOff();
  pumpOff();
}

void readyAgain() {
  estop = 0;
  motorsOff();
  pumpOff();
}

void sendGpsDiagnostic() {
  Monitor.print("GPS_DIAG bytes=");
  Monitor.print(gpsByteCount);
  Monitor.print(" lines=");
  Monitor.print(gpsSentenceCount);
  Monitor.print(" fix=");
  Monitor.print(hasGpsFix ? "1" : "0");
  Monitor.print(" sats=");
  Monitor.print(satelliteCount);
  Monitor.print(" raw=");
  Monitor.println(lastRawSentence);
}

void runCommand(String command) {
  if (command == "CMD:MOVE:FORWARD") {
    goForward();
  }
  if (command == "CMD:MOVE:BACK") {
    goBack();
  }
  if (command == "CMD:MOVE:LEFT") {
    spinLeft();
  }
  if (command == "CMD:MOVE:RIGHT") {
    spinRight();
  }
  if (command == "CMD:MOVE:STOP") {
    motorsOff();
  }
  if (command == "CMD:OIL:START") {
    pumpStart();
  }
  if (command == "CMD:PUMP:ON") {
    pumpStart();
  }
  if (command == "CMD:OIL:STOP") {
    pumpOff();
  }
  if (command == "CMD:PUMP:OFF") {
    pumpOff();
  }
  if (command == "CMD:DISCONNECT") {
    motorsOff();
    pumpOff();
  }
  if (command == "CMD:ESTOP:ACTIVE") {
    stopAll();
  }
  if (command == "CMD:ESTOP:RESET") {
    readyAgain();
  }
  if (command == "CMD:INIT") {
    readyAgain();
  }
  if (command == "CMD:GPS:CHECK") {
    sendGpsDiagnostic();
  }

  Monitor.print("ACK ");
  Monitor.println(command);
}

void setup() {
  pinMode(rightRed, OUTPUT);
  pinMode(rightBlack, OUTPUT);
  pinMode(leftRed, OUTPUT);
  pinMode(leftBlack, OUTPUT);
  pinMode(pumpPin, OUTPUT);
  motorsOff();
  pumpOff();
  Serial1.begin(9600);
  Bridge.begin();
}

void loop() {
  while (Serial1.available() > 0) {
    char c = (char)Serial1.read();
    gpsByteCount++;
    if (c == '\n') {
      nmeaLine.trim();
      if (nmeaLine.length() > 0) {
        parseNmeaLine(nmeaLine);
      }
      nmeaLine = "";
    } else if (c != '\r' && nmeaLine.length() < 120) {
      nmeaLine += c;
    }
  }

  if (Monitor.begin() == false) {
    delay(20);
  } else {
    if (Monitor.available() > 0) {
      String command = Monitor.readStringUntil('\n');
      command.trim();
      if (command.length() > 0) {
        runCommand(command);
      }
    }
    unsigned long now = millis();
    if (now - lastGpsReportMs >= 1000) {
      lastGpsReportMs = now;
      if (hasGpsFix) {
        Monitor.print("GPS ");
        Monitor.print(latestLat, 6);
        Monitor.print(",");
        Monitor.println(latestLon, 6);
      } else {
        // Output periodic diag so Linux backend knows module rx status
        sendGpsDiagnostic();
      }
    }
  }
