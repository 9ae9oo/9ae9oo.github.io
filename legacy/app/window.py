from pickle import TRUE
from app.theme import (
    COLOR_BG, COLOR_POINT, COLOR_TEXT, COLOR_GRAY, COLOR_BORDER, FONT_FAMILY
)
import os #import: 도구를 가져온다 / os:운영체제 관련 기능
from PyQt6.QtWidgets import (
    QWidget, QHBoxLayout, QLabel, QPushButton, QVBoxLayout
)
from PyQt6.QtCore import Qt, QSize, QPoint # [수정] QPoint 추가
from PyQt6.QtGui import QIcon
from app.theme import (
    COLOR_BG, COLOR_POINT, COLOR_BORDER, 
    COLOR_ICON, COLOR_ICON_HOVER, FONT_FAMILY, get_font,
    COLOR_TEXT, COLOR_BLACK, COLOR_GRAY, COLOR_WHITE)
from app.pomodoro import PomodoroWidget
from app.todo import TodoWidget

#아래는 PyQt6.QtWidgets들 - 화면에 보이는 것들 모음
# QApplication는 앱 전체를  켜는 엔진
# QWidget은 기본창/빈공간을 만드는 클래스
# QHBoxLayout은 가로로 나란히 배치하는 레이아웃 (Horizontal에서 따온듯)
# QVBoxLayout은 세로로 나란히 배치하는 레이아웃 (Vertical에서 따온듯)
# QLabel은 텍스트를 표시
# QPushButton은 클릭 가능한 버튼

#PyQt6.QtCore - 창 동작 관련 설정
# Qt : 타이틀바 제거 옵션
# Qsize : 크기 지정(16,16) 같은거

#PyQt6.QtGui - 그래픽 관련
# QIcon : 버튼에 아이콘 넣기

class MainWindow(QWidget):
    def __init__(self): #self = 이창 자신
        super().__init__()

        self.pinned = False
        self._drag_pos = QPoint() # [수정] 창 드래그 이동을 위한 좌표 변수 초기화

        self.setWindowFlags(Qt.WindowType.FramelessWindowHint)
        self.setFixedWidth(300)
        self.resize(300, 600)

        main_layout = QVBoxLayout(self)
        main_layout.setContentsMargins(0, 0, 0, 0)
        main_layout.setSpacing(0)

        # 타이틀바  
        title_bar = QWidget()
        title_bar.setFixedHeight(36)
        title_bar.setStyleSheet(f"background-color: {COLOR_BG}; border-bottom: 1px solid {COLOR_BORDER};") # 타이틀바 배경색과 테두리 설정
        #F 없이-직접 입력, F가 있다면 - 변수 사용
        #색을 일일히 넣는 것을 하드 코딩이라고 한다.
        title_layout = QHBoxLayout(title_bar)
        title_layout.setContentsMargins(10, 0, 6, 0) # 타이틀바 좌우 마진 설정

        title_label = QLabel("Pomo-to-do")
        title_label.setFont(get_font(12, bold=True)) # 타이틀바 텍스트 스타일 설정
        title_label.setStyleSheet(f"font-size: 12px; color: {COLOR_TEXT};")

        self.btn_pin = QPushButton()
        self.btn_pin.setIcon(QIcon("assets/icons/pin_off.png")) # 핀 버튼 아이콘 설정
        self.btn_pin.clicked.connect(self.toggle_pin)

            #self = 이 창 

        btn_settings = QPushButton()
        btn_settings.setIcon(QIcon("assets/icons/settings.png"))    

        btn_min = QPushButton()
        btn_min.setIcon(QIcon("assets/icons/minimize.png"))

        btn_close = QPushButton()
        btn_close.setIcon(QIcon("assets/icons/close.png"))

        for btn in [self.btn_pin, btn_settings, btn_min, btn_close]: #←이것들에 하단의 설정값을 반복해 적용한다.
            btn.setFixedSize(24, 24)
            btn.setIconSize(QSize(16, 16))
            btn.setStyleSheet("border: none; background: transparent;") # 버튼 스타일 설정
            #btn은 임시 (item이나 b button으로 바꿔도 작동한다. 지금 처리중인 버튼이란 뜻)

        btn_close.clicked.connect(self.close) # 닫기 버튼 클릭 시 창 닫기
        btn_min.clicked.connect(self.showMinimized) # 최소화 버튼 클릭 시 창 최소화

        title_layout.addWidget(title_label)
        title_layout.addStretch()
        title_layout.addWidget(self.btn_pin) 
        title_layout.addWidget(btn_settings)
        title_layout.addWidget(btn_min)
        title_layout.addWidget(btn_close)

        body = QWidget()
        body.setStyleSheet(f"background-color: {COLOR_BG};")
        body_layout = QVBoxLayout(body)
        body_layout.setContentsMargins(10, 0, 10, 10) #마진의 순서는 시계 반대방향, 왼쪽, 위, 오른쪽, 아래
        body_layout.setSpacing(0) #구역들 사이 간격
        # 음악 플레이어 자리
        music_area = QWidget()
        music_area.setFixedHeight(40)
        music_area.setStyleSheet(f"background-color: {COLOR_BG};")

        # 구분선
        divider1 = QWidget()
        divider1.setFixedHeight(1)
        divider1.setStyleSheet(f"background-color: {COLOR_BORDER};")

        # 포모도로 타이머 자리
        pomo_area = PomodoroWidget() 
        pomo_area.setStyleSheet(f"background-color: {COLOR_BG};")
        #PomodoroWidget:클래스 자체 - 설계도 
        #PomodoroWidget():클래스로 만든 객체 (실제 창)

        # 구분선
        divider2 = QWidget()
        divider2.setFixedHeight(1)
        divider2.setStyleSheet(f"background-color: {COLOR_BORDER};")

        # 사용 시간 자리
        usage_area = QWidget()
        usage_area.setFixedHeight(80)
        usage_area.setStyleSheet(f"background-color: {COLOR_BG};")

        # 구분선
        divider3 = QWidget()
        divider3.setFixedHeight(1)
        divider3.setStyleSheet(f"background-color: {COLOR_BORDER};")

        # 투두 리스트 자리
        todo_area = TodoWidget()

        # 레이아웃에 추가
        body_layout.addWidget(music_area)
        body_layout.addWidget(divider1)
        body_layout.addWidget(pomo_area)
        body_layout.addWidget(divider2)
        body_layout.addWidget(usage_area)
        body_layout.addWidget(divider3)
        body_layout.addWidget(todo_area)
        body_layout.addStretch()

        main_layout.addWidget(title_bar)
        main_layout.addWidget(body)

    # [수정] 마우스 드래그로 창을 이동할 수 있도록 이벤트 추가
    def mousePressEvent(self, event):
        if event.button() == Qt.MouseButton.LeftButton:
            # 클릭한 시점의 마우스 전역 위치에서 창의 좌상단 위치를 빼서 차이를 저장합니다.
            self._drag_pos = event.globalPosition().toPoint() - self.frameGeometry().topLeft()
            event.accept()

    def mouseMoveEvent(self, event):
        if event.buttons() == Qt.MouseButton.LeftButton and not self._drag_pos.isNull():
            # 마우스를 움직일 때 창을 같이 이동시킵니다.
            self.move(event.globalPosition().toPoint() - self._drag_pos)
            event.accept()

    def toggle_pin(self): # self = 이 창 자신 (괄호안에 self)가 없다면 __init__안에서 만들고 레이아웃에 추가하는 것으로 끝.
        self.pinned = not self.pinned #toggle_pin(self)에서 self를 붙히면 클래서 어디서든 꺼내 쓸 수 있음

        # self.btn_pin 나중에 다른 함수에서도 써야 할 때 self.을 붙힘
        # btn_settings self가 없으면 이 자리에서만 씀. 만약 설정 버튼 클릭 기능을 추가시 self.btn_setting으로 바꿈.

        if self.pinned: #self.pinned = ... : 이 창의 pinned 값
            self.setWindowFlags( 
                Qt.WindowType.FramelessWindowHint |
                Qt.WindowType.WindowStaysOnTopHint
            )
            self.btn_pin.setIcon(QIcon("assets/icons/pin_on.png")) #self.btn_pin.setIcon() : 이창의 아이콘 변경
        else:
            self.setWindowFlags(Qt.WindowType.FramelessWindowHint) #self.setWindowFlags() : 이 창의 설정 변경
            self.btn_pin.setIcon(QIcon("assets/icons/pin_off.png"))

        self.show() #self.show() : 이 창을 보여줌