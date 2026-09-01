# 1초마다 tick 함수 실행
# timer = QTimer()
# timer.timeout.connect(tick) - 시간이 될 때마다 tick 호출
# timer.start(1000)           - 1000ms = 1초

from PyQt6.QtCore import QTimer, QObject, pyqtSignal, Qt, QRect, QSize, QPoint
from PyQt6.QtWidgets import QWidget, QVBoxLayout
from PyQt6.QtGui import QPainter, QColor, QFont, QPolygon
from app.theme import COLOR_ICON, COLOR_ICON_HOVER, COLOR_TIMER, COLOR_TIMER_BACK, COLOR_GRAY, COLOR_WHITE, FONT_FAMILY, get_font

 #pyqtSignal = 이런일이 일어났어 알려주는 방식
 # tick = pyqtSignal(int)  # int형 데이터를 담아 신호 발송
 # self.tick.emit(self.remaining)  # 신호 발송

#QPainter=는 도화지에 그림을 그리는 도구
## 원 그리기 painter.drawEllipse(x, y, width, height)
# 호(arc) 그리기 — 타이머에 사용 painter.drawArc(x, y, width, height, start_angle, span_angle)


class PomodoroTimer(QObject):
    # 외부에서 감지할 수 있는 신호들
    tick = pyqtSignal(int)        # 매초 남은 시간(초) 전달 int=정수 예)1,25,1500같은 숫자
    session_changed = pyqtSignal(str)  # 세션 변경 시 이름 전달 (work/short/long) str = 문자열 예) work나 안녕같은 문자
    finished = pyqtSignal()       # 전체 완료 시

    def __init__(self):
        super().__init__()
        #__init__은 클래스가 처음 만들어질 때 자동으로 실행되는 함수, 일종의 초기 세팅
        # super().__init__() 은 부모 클래스의 초기 세팅을 먼저 실행

        # 기본 시간 설정 (초 단위)
        self.work_time = 25 * 60       # 25분
        self.short_break = 5 * 60      # 5분
        self.long_break = 15 * 60      # 15분
        self.repeat = 4                # 반복 횟수

        self.current_session = "work"  # 현재 세션
        self.session_count = 1         # 현재 몇 번째 세션
        self.remaining = self.work_time  # 남은 시간(초) remaing=남은
        self.running = False           # 실행 중 여부

        # QTimer 설정 — 1초마다 _tick 함수 호출
        self.timer = QTimer()
        self.timer.setInterval(1000)   # 1000ms = 1초 setInterval는 타이머 설정
        self.timer.timeout.connect(self._tick)

    def start(self):
        self.running = True
        self.timer.start()

    def pause(self):
        self.running = False
        self.timer.stop()

    def reset(self):
        self.timer.stop()
        self.running = False
        self.current_session = "work"
        self.session_count = 1
        self.remaining = self.work_time
        self.tick.emit(self.remaining)  # UI에 초기값 전달

    def _tick(self):
        # 1초마다 실행되는 함수
        self.remaining -= 1
        self.tick.emit(self.remaining)  
        # UI에 남은 시간 전달 emit = 신호 발사, tick.emit= 숫자(남은 시간) 
        # self.session_changed.emit(self.current_session) #해당 코드는 문자(세션 이름)을 담아 보내는 것

        if self.remaining <= 0:
            self._next_session()

    def _next_session(self):
        # 세션 전환 로직
        self.timer.stop()    # ← 버그 수정용 추가
        self.running = False # ← 버그 수정용 추가
        if self.current_session == "work":
            if self.session_count >= self.repeat:
                # 마지막 세션이면 긴 휴식
                self.current_session = "long_break"
                self.remaining = self.long_break
                self.session_count = 1
            else:
                # 아니면 짧은 휴식
                self.current_session = "short_break"
                self.remaining = self.short_break
                self.session_count += 1
        else:
            # 휴식 끝나면 다시 작업
            self.current_session = "work"
            self.remaining = self.work_time

        self.session_changed.emit(self.current_session)


class PomodoroWidget(QWidget):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.timer = PomodoroTimer()  # 타이머 로직 연결
        self.setFixedHeight(220)

        layout = QVBoxLayout(self)
        layout.setAlignment(Qt.AlignmentFlag.AlignCenter)  # 가운데 정렬
        layout.setContentsMargins(0, 0, 0, 0)


        # 원형 타이머 그리는 캔버스
        self.canvas = TimerCanvas(self.timer)
        self.canvas.setFixedSize(200, 200) #원의 크기, 숫자를 키우면 원도 커짐.
        layout.addWidget(self.canvas, alignment=Qt.AlignmentFlag.AlignCenter)

        # 타이머 신호 연결
        self.timer.tick.connect(self.canvas.update)

class TimerCanvas(QWidget):
    # 원형 타이머를 직접 그리는 클래스
    def __init__(self, timer):
        super().__init__()
        self.timer = timer
        #호버가 필요없다면 여기서부터
        self.setMouseTracking(True)  # 마우스 움직임 감지

        # hover 상태 추적
        self.hover_play = False
        self.hover_reset = False
        #호버가 필요없다면 여기까지

    def _btn_rects(self): #버튼 영역 정의 — 원 아래쪽 중앙
        cx = self.width() // 2   # 캔버스 가로 중앙
        cy = self.height()       # 캔버스 세로 끝

        # 재생/일시정지 버튼 영역
        play_rect = QRect(cx - 35, cy - 70, 32, 32)
        # 리셋 버튼 영역
        reset_rect = QRect(cx + 0, cy - 70, 32, 32)

        return play_rect, reset_rect
        
    #호버가 필요 없다면 여기서부터
    def mouseMoveEvent(self, event):
        # 마우스가 버튼 위에 있는지 확인 → hover 상태 변경
        play_rect, reset_rect = self._btn_rects()
        self.hover_play = play_rect.contains(event.pos())
        self.hover_reset = reset_rect.contains(event.pos())
        self.update()  # 화면 다시 그리기
        #호버가 필요없다면 여기까지

    def mousePressEvent(self, event):
        play_rect, reset_rect = self._btn_rects()
        if play_rect.contains(event.pos()):
            self._toggle_play()
        elif reset_rect.contains(event.pos()):
            self._reset()

    def _toggle_play(self):
        if self.timer.running:
            self.timer.pause()
        else:
            self.timer.start()
        self.update()

    def _reset(self):
        self.timer.reset()
        self.update()

    def paintEvent(self, event):
        # paintEvent — 화면을 그릴 때 자동 호출
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)  # 안티앨리어싱

        w = self.width()
        h = self.height()
        margin = 10 #숫자를 줄이면 원이 더 꽉 차게 커저요
        # 원 영역 — 버튼 공간 확보를 위해 위쪽에 배치
        rect = QRect(margin, margin, w - margin * 2, h - margin * 2)

        # 배경 회색 원
        painter.setPen(Qt.PenStyle.NoPen)
        painter.setBrush(QColor(COLOR_TIMER_BACK))
        painter.drawEllipse(rect)

        # 빨간 파이 — 남은 시간 비율
        session_times = {
            "work": self.timer.work_time,
            "short_break": self.timer.short_break,
            "long_break": self.timer.long_break,
        }
        total = session_times.get(self.timer.current_session, self.timer.work_time)
        remaining = self.timer.remaining
        ratio = remaining / total if total > 0 else 0
        painter.setBrush(QColor(COLOR_TIMER))
        span = int(360 * 16 * ratio) # Qt는 각도를 1/16도 단위로 사용
        painter.drawPie(rect, 90 * 16, -span) # 12시 방향부터 시작

        # 세션 표시 (1/4) — 원 위쪽
        session_str = f"{self.timer.session_count}/{self.timer.repeat}"
        painter.setFont(get_font(12))
        painter.setPen(QColor(COLOR_WHITE))
        painter.drawText(
            QRect(margin, margin + 40, w - margin * 2, 20),
            Qt.AlignmentFlag.AlignHCenter, session_str
        )    

        #시간 텍스트 — 원 가운데
        minutes = remaining // 60
        seconds = remaining % 60
        time_str = f"{minutes:02d}:{seconds:02d}"
        font = (get_font(24, bold=True))
        font.setBold(True)
        painter.setFont(font)
        painter.setPen(QColor(COLOR_WHITE))
        painter.drawText(rect, Qt.AlignmentFlag.AlignCenter, time_str)

        # 버튼 영역
        play_rect, reset_rect = self._btn_rects()

        #호버가 필요없다면 여기서부터
        # 버튼 hover 색상 — hover 시 포인트 컬러, 기본은 화이트
        play_color = QColor(COLOR_ICON_HOVER) if self.hover_play else QColor(COLOR_ICON)
        reset_color = QColor(COLOR_ICON_HOVER) if self.hover_reset else QColor(COLOR_ICON)
        #호버가 필요없다면 여기까지 if를 삭제하고 _hover를 지움

        # 재생/일시정지 아이콘 그리기
        painter.setPen(Qt.PenStyle.NoPen)
        cx = play_rect.center().x() #cx = 버튼의 왼쪽 시작점 (cx-40 : 가로 중앙에서 40px 왼쪽으로)
        cy = play_rect.center().y() #cy = 버튼의 위쪽 시작점 (cy-54 : 캔버스 아래에서 54px 위)

        if self.timer.running:
            # 일시정지 — 두 개의 사각형
            painter.setBrush(play_color)
            painter.drawRect(cx - 7, cy - 7, 5, 14)  # 왼쪽 바 (cx,cy 버튼 가로크기, 세로크기)
            painter.drawRect(cx + 2, cy - 7, 5, 14)  # 오른쪽 바
        else:
            # 재생 — 삼각형
            painter.setBrush(play_color)
            triangle = QPolygon([
                QPoint(cx - 5, cy - 8),  # 왼쪽 위
                QPoint(cx - 5, cy + 8),  # 왼쪽 아래
                QPoint(cx + 9, cy),      # 오른쪽 중앙
            ])
            painter.drawPolygon(triangle)

        # 리셋 아이콘 — 원형 화살표 (단순화: 호 + 화살표)
        from PyQt6.QtGui import QPen
        pen = QPen(reset_color)
        pen.setWidth(2)
        pen.setCapStyle(Qt.PenCapStyle.RoundCap)
        painter.setPen(pen)
        painter.setBrush(Qt.BrushStyle.NoBrush)
        rx = reset_rect.center().x()
        ry = reset_rect.center().y()
        painter.drawArc(QRect(rx - 7, ry - 7, 14, 14), 40 * 16, 290 * 16)

        # 리셋 화살표 머리
        painter.setPen(Qt.PenStyle.NoPen)
        painter.setBrush(reset_color)
        arrow = QPolygon([
            QPoint(rx + 5, ry - 10),
            QPoint(rx + 10, ry - 6),
            QPoint(rx + 4, ry - 4),
        ])
        painter.drawPolygon(arrow)