import os
import urllib.request
from PyQt6.QtGui import QFontDatabase, QFont, QColor

# 색상
COLOR_BG = "#ffffff" 
COLOR_POINT = "#E24B4A"
COLOR_BORDER = "#e0e0e0"

COLOR_TEXT = "#222222"

COLOR_BLACK = "#333333"
COLOR_WHITE = "#ffffff"
COLOR_GRAY = "#e0e0e0"

COLOR_TIMER = "#c24444"
COLOR_TIMER_BACK = "#f0f0f0"

COLOR_ICON = "#FFFFFF"
COLOR_ICON_HOVER = "#E24B4A"

# 폰트
FONT_FAMILY = "Pretendard" 

# 폰트 파일 경로
FONT_FILE = "assets/fonts/Pretendard-Regular.otf"

def load_pretendard():
    # 파일 있으면 로드, 없으면 기본 폰트 사용
    if os.path.exists(FONT_FILE):
        QFontDatabase.addApplicationFont(FONT_FILE)
        print("Pretendard 폰트 로드 완료!")
    else:
        print("폰트 파일 없음, 기본 폰트 사용")

def get_font(size=12, bold=False):
    available = QFontDatabase.families()

    if "Pretendard" in available:
        font = QFont("Pretendard", size)
    else:
        font = QFont("Malgun Gothic", size)

    font.setBold(bold)
    return font