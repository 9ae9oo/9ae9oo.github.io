import json
import os

DATA_FILE = "data/pomo-to-do.json"

# 기본값 — 앱 처음 실행 시 이 값으로 시작
DEFAULT_DATA = {
    "settings": {
        "point_color": "#E24B4A",
        "sub_color": "#888888"
    },
    "todos": [],
    "pomodoro": {
        "work": 25,
        "short_break": 5,
        "long_break": 15,
        "repeat": 4
    },
    "tracking": {
        "focus_apps": [],
        "distract_apps": []
    },
    "music": []
}

def load():
    # 파일 없으면 기본값으로 새로 만들기
    if not os.path.exists(DATA_FILE): #path=파일 경로, exists=존재하냐?
        save(DEFAULT_DATA)
        return DEFAULT_DATA

    with open(DATA_FILE, "r", encoding="utf-8") as f: #DATA_FILE, "r"에서 r은 read, 파일 내용 불러올 때
        return json.load(f)

def save(data):
    # data 폴더 없으면 생성
    os.makedirs("data", exist_ok=True) #os.makedirs()=make directories
    # exist_ok=True → 폴더가 이미 있어도 에러 없이 넘어가요
    # exist_ok=False → 폴더가 이미 있으면 에러 발생

    with open(DATA_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2) 
        #ensure(보장하다) ascii(아스키), true가 아니라 false면 한글이 깨짐
        #indent=2는 들여쓰기를 보기 좋게함.

def reset():
    # 기본값으로 초기화
    save(DEFAULT_DATA)
    return DEFAULT_DATA