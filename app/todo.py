# 데이터 — 할 일 하나의 구조
#{
#    "id": 1,
#    "text": "할 일 내용",
#    "done": False  # 완료 여부
#}

from PyQt6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QLineEdit,
    QPushButton, QScrollArea, QLabel, QCheckBox
)
from PyQt6.QtCore import Qt, pyqtSignal, QRect, QPoint
from PyQt6.QtGui import QFont, QPainter, QColor, QPen
from app.theme import (
    COLOR_BG, COLOR_POINT, COLOR_BORDER, 
    COLOR_ICON, COLOR_ICON_HOVER, FONT_FAMILY, get_font,
    COLOR_TEXT, COLOR_BLACK, COLOR_GRAY, COLOR_WHITE
)
from app.storage import load, save

class CheckButton(QWidget):
    # 체크 상태가 바뀌면 신호 발송
    toggled = pyqtSignal(bool)

    def __init__(self, checked=False, parent=None):
        super().__init__(parent)
        self.checked = checked
        self.setFixedSize(16, 16) #체크박스 크기 수정
        self.setCursor(Qt.CursorShape.PointingHandCursor)  # 마우스 포인터 변경

    def mousePressEvent(self, event):
        self.checked = not self.checked
        self.toggled.emit(self.checked)
        self.update()  # 다시 그리기

    def paintEvent(self, event):
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)

        rect = QRect(1, 1, 14, 14)

        if self.checked:
            # 체크됐을 때 — 빨간 배경 + 흰 체크 표시
            painter.setPen(Qt.PenStyle.NoPen)
            painter.setBrush(QColor("#E24B4A"))
            painter.drawRoundedRect(rect, 3, 3)

            # 흰색 체크 표시 그리기
            pen = QPen(QColor("#ffffff"))
            pen.setWidth(2)
            pen.setCapStyle(Qt.PenCapStyle.RoundCap)
            pen.setJoinStyle(Qt.PenJoinStyle.RoundJoin)
            painter.setPen(pen)
            painter.setBrush(Qt.BrushStyle.NoBrush)
            # ✓ 모양 — 두 선으로 그리기
            painter.drawLine(
                QPoint(4, 9),   # 왼쪽
                QPoint(7, 13)   # 가운데 아래
            )
            painter.drawLine(
                QPoint(7, 13),  # 가운데 아래
                QPoint(13, 5)   # 오른쪽 위
            )
        else:
            # 체크 안됐을 때 — 흰 배경 + 회색 테두리
            pen = QPen(QColor("#e0e0e0"))
            pen.setWidth(1)
            painter.setPen(pen)
            painter.setBrush(QColor("#ffffff"))
            painter.drawRoundedRect(rect, 3, 3)

class DeleteButton(QWidget):
    clicked = pyqtSignal()

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setFixedSize(16, 16) #삭제 버튼 크기 수정
        self.setCursor(Qt.CursorShape.PointingHandCursor)
        self.hovered = False
        self.setMouseTracking(True)

    def mousePressEvent(self, event):
        self.clicked.emit()

    def enterEvent(self, event):   # 마우스 올라올 때
        self.hovered = True
        self.update()

    def leaveEvent(self, event):   # 마우스 나갈 때
        self.hovered = False
        self.update()

    def paintEvent(self, event):
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)

        # hover 시 빨간색, 기본은 회색
        color = QColor(COLOR_POINT) if self.hovered else QColor(COLOR_GRAY)

        pen = QPen(color)
        pen.setWidth(2)          # ← 굵기 조절
        pen.setCapStyle(Qt.PenCapStyle.RoundCap)
        painter.setPen(pen)

        # X 그리기 — 대각선 두 줄
        painter.drawLine(QPoint(5, 5),   QPoint(15, 15))  # ↘
        painter.drawLine(QPoint(15, 5),  QPoint(5, 15))   # ↙

class AddButton(QWidget):
    clicked = pyqtSignal()

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setFixedSize(24, 24) #add 버튼 사이즈
        self.setCursor(Qt.CursorShape.PointingHandCursor)
        self.hovered = False
        self.setMouseTracking(True)

    def mousePressEvent(self, event):
        self.clicked.emit()

    def enterEvent(self, event):
        self.hovered = True
        self.update()

    def leaveEvent(self, event):
        self.hovered = False
        self.update()

    def paintEvent(self, event):
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)

        # 배경 테두리
        pen = QPen(QColor(COLOR_POINT))
        pen.setWidth(1) #배경 테두리 굵기
        painter.setPen(pen)
        painter.setBrush(
            QColor(COLOR_WHITE) if self.hovered else QColor(COLOR_POINT)
        )
        painter.drawRoundedRect(QRect(1, 1, 22, 22), 1, 1) 

        # + 그리기 — 가로 + 세로 두 줄
        color = QColor(COLOR_POINT) if self.hovered else QColor(COLOR_WHITE)
        pen = QPen(color)
        pen.setWidth(2)          # ← 굵기 조절
        pen.setCapStyle(Qt.PenCapStyle.RoundCap)
        painter.setPen(pen)

        cx, cy = 12, 12
        size = 4                 # ← 크기 조절
        painter.drawLine(QPoint(cx - size, cy), QPoint(cx + size, cy))  # 가로
        painter.drawLine(QPoint(cx, cy - size), QPoint(cx, cy + size))  # 세로

class TodoWidget(QWidget):
    def __init__(self, parent=None):
        super().__init__(parent)

        self.data = load()  # JSON 불러오기
        if "todos" not in self.data:
            self.data["todos"] = []

        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 20, 0, 8) #입력창의 (왼쪽, 위, 오른쪽, 아래) duqor
        layout.setSpacing(6)

        # 입력창 + 추가 버튼 
        # padding은 입력창등의 내부 여백 (차례대로 위아래와 좌우 여백 사이즈), 
        # margin은 입력창 외부와 다른 요소 사이의 간격 (margin-top : 1px등으로 쓰인다.)
        input_layout = QHBoxLayout()
        input_layout.setSpacing(6)

        self.input = QLineEdit()
        self.input.setPlaceholderText("할 일 추가...")
        self.input.setStyleSheet(f"""
            QLineEdit {{
                border: 1px solid {COLOR_BORDER};
                border-radius: 4px;
                font-family: {FONT_FAMILY};
                font-size: 12pt;
                color: {COLOR_TEXT};
                background: {COLOR_BG};
                padding: 2px, 4px;
            }}
        """)
        # 엔터 키로도 추가 가능
        self.input.returnPressed.connect(self.add_todo)

        #추가 버튼
        btn_add = AddButton()
        btn_add.clicked.connect(self.add_todo)
        #할일 입력칸
        input_layout.addWidget(self.input)
        input_layout.addWidget(btn_add)
        layout.addLayout(input_layout) 

        # 스크롤 영역
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setStyleSheet(f"""
                QScrollArea {{
                    border: 1px solid {COLOR_BORDER};
                    border-radius: 8px;
                    background: transparent;
                }}
            """)
        scroll.setHorizontalScrollBarPolicy(
            Qt.ScrollBarPolicy.ScrollBarAlwaysOff
        )

        # 스크롤 안 컨테이너
        self.list_container = QWidget()
        self.list_layout = QVBoxLayout(self.list_container)
        self.list_layout.setContentsMargins(0, 0, 0, 0)
        self.list_layout.setSpacing(0)
        self.list_layout.addStretch()

        scroll.setWidget(self.list_container)
        layout.addWidget(scroll)

        # 저장된 투두 불러오기
        self.refresh_list()

    def add_todo(self):
        text = self.input.text().strip()
        if not text:
            return

        # 새 할 일 추가
        new_todo = {
            "id": len(self.data["todos"]) + 1,
            "text": text,
            "done": False
        }
        self.data["todos"].append(new_todo)
        save(self.data)

        self.input.clear()
        self.refresh_list()

    def toggle_done(self, todo_id):
        # 체크박스 토글
        for todo in self.data["todos"]:
            if todo["id"] == todo_id:
                todo["done"] = not todo["done"]
                break
        save(self.data)
        self.refresh_list()

    def delete_todo(self, todo_id):
        # 삭제
        self.data["todos"] = [
            t for t in self.data["todos"]
            if t["id"] != todo_id
        ]
        save(self.data)
        self.refresh_list()

    def refresh_list(self):
        # 리스트 전체 다시 그리기
        # 미완료 → 완료 순으로 정렬
        todos = sorted(
            self.data["todos"],
            key=lambda t: t["done"]  # False(미완료) 먼저
        )

        # 기존 항목 전부 제거
        while self.list_layout.count() > 1:
            item = self.list_layout.takeAt(0)
            if item.widget():
                item.widget().deleteLater()

        # 항목 다시 추가
        for todo in todos:
            row = self._make_row(todo)
            self.list_layout.insertWidget(
                self.list_layout.count() - 1, row
            )

    def _make_row(self, todo):
        # 할 일 한 줄 위젯
        row = QWidget()
        row_layout = QHBoxLayout(row)
        row_layout.setContentsMargins(4, 2, 4, 2) #컨텐츠의 마진
        row_layout.setSpacing(10) #항목간 간격

        # 체크 박스
        checkbox = CheckButton(checked=todo["done"])
        checkbox.toggled.connect(
            lambda checked, tid=todo["id"]: self.toggle_done(tid)
        )

        # 텍스트 라벨
        label = QLabel(todo["text"])
        label.setFont(get_font(size=10))
        label.setWordWrap(True)

        if todo["done"]:
            # 완료 시 취소선 + 회색
            label.setStyleSheet(
                f"text-decoration: line-through; color: {COLOR_GRAY};"
            )
        else:
            label.setStyleSheet(f"color: {COLOR_TEXT};")

            # 더블클릭 시 수정 모드 진입
        label.mouseDoubleClickEvent = lambda _, tid=todo["id"], lbl=label, r=row_layout: \
            self._enter_edit_mode(tid, lbl, r)

        # 삭제 버튼
        btn_del = DeleteButton()
        btn_del.clicked.connect(
            lambda tid=todo["id"]: self.delete_todo(tid)
        )

        row_layout.addWidget(checkbox)
        row_layout.addWidget(label, stretch=1)
        row_layout.addWidget(btn_del)

        return row

    def _enter_edit_mode(self, todo_id, label, row_layout):
        # 현재 텍스트 가져오기
        current_text = label.text()

        # 라벨 숨기기
        label.hide()

        # 입력창 생성
        edit = QLineEdit(current_text)
        edit.setStyleSheet(f"""
            QLineEdit {{
                border: 1px solid {COLOR_POINT};
                border-radius: 4px;
                padding: 2px 6px;
                font-family: {FONT_FAMILY};
                font-size: 12pt;
                color: {COLOR_TEXT};
                background: {COLOR_BG};
            }}
        """)

        # 확인 버튼
        btn_confirm = QWidget()
        btn_confirm.setFixedSize(20, 20)
        btn_confirm.setCursor(Qt.CursorShape.PointingHandCursor)

        def paintConfirm(event, w=btn_confirm):
            painter = QPainter(w)
            painter.setRenderHint(QPainter.RenderHint.Antialiasing)
            pen = QPen(QColor(COLOR_POINT))
            pen.setWidth(2)
            pen.setCapStyle(Qt.PenCapStyle.RoundCap)
            pen.setJoinStyle(Qt.PenJoinStyle.RoundJoin)
            painter.setPen(pen)
            painter.drawLine(QPoint(4, 10), QPoint(8, 14))
            painter.drawLine(QPoint(8, 14), QPoint(16, 6))

        btn_confirm.paintEvent = paintConfirm
        btn_confirm.setCursor(Qt.CursorShape.PointingHandCursor)

        def confirm():
            new_text = edit.text().strip()
            if new_text:
                self._save_edit(todo_id, new_text)
            else:
                # 빈 텍스트면 수정 취소
                self._cancel_edit(edit, btn_confirm, label, row_layout)

        edit.returnPressed.connect(confirm)
        btn_confirm.mousePressEvent = lambda e: confirm()

        # 라벨 자리에 입력창 삽입
        idx = row_layout.indexOf(label)
        row_layout.insertWidget(idx + 1, edit)
        row_layout.insertWidget(idx + 2, btn_confirm)

        edit.setFocus()
        edit.selectAll()  # 기존 텍스트 전체 선택

    def _cancel_edit(self, edit, btn_confirm, label, row_layout):
        edit.deleteLater()
        btn_confirm.deleteLater()
        label.show()

    def _save_edit(self, todo_id, new_text):
        for todo in self.data["todos"]:
            if todo["id"] == todo_id:
                todo["text"] = new_text
                break
        save(self.data)
        self.refresh_list()