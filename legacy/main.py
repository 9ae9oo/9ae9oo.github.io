import sys
import os #운영체제 관련 기능
from PyQt6.QtWidgets import QApplication, QHBoxLayout, QWidget
from PyQt6.QtGui import QGuiApplication  # [수정] 임포트 추가
from PyQt6.QtCore import Qt              # [수정] 임포트 추가
from app.window import MainWindow
from app.theme import load_pretendard
#아래는 PyQt6.QtWidgets들 - 화면에 보이는 것들 모음
#QApplication는 앱 전체를  켜는 엔진

os.chdir(os.path.dirname(os.path.abspath(__file__)))
#os.chdir(...)은 실행경로 고정

# [수정] PassThrough는 125%, 150% 배율에서 폰트를 흐릿하게 만듭니다. Round로 변경하여 글자 깨짐 방지!
QGuiApplication.setHighDpiScaleFactorRoundingPolicy(
    Qt.HighDpiScaleFactorRoundingPolicy.Round
)

app = QApplication(sys.argv)
load_pretendard() # 앱 시작시 폰트 로드
window = MainWindow()
window.show()
sys.exit(app.exec())