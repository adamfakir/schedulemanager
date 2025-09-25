from flask import Blueprint, jsonify, request, session
from bson import ObjectId
from datetime import datetime, timezone
import json

from models.teacher import Teacher
from models.timemodels import TimeBlock, WeekTime
from models.user import User
from models.subject import Subject
from models.organization import Organization
from routes.userAPI import get_logged_in_user

teacherAPI = Blueprint("teacher", __name__)

def parse_datetime(dt_str):
    """Helper to parse ISO formatted datetime string if provided."""
    try:
        return datetime.fromisoformat(dt_str)
    except Exception:
        return None


@teacherAPI.route("/create", methods=["POST"])
def create_teacher():
    data = request.json
    # If a userid is provided, fetch that user; otherwise, get the logged in user.
    user = get_logged_in_user()
    if not user:
        return jsonify({"error": "Unauthorized"}), 401
    created_at = data.get("created_at")
    if created_at:
        created_at = parse_datetime(created_at)
    else:
        created_at = datetime.now(timezone.utc)

    name = data.get("name")
    canteachlist = []
    for i in data.get("can_teach",[]):
        try:
            canteachlist.append(Subject.objects.get(id=ObjectId(i)))
        except Exception as e:
            return jsonify({"error": "Subject for canteach with provided id not found", "details": str(e)}), 404
    reqteachlist = []
    for i in data.get("required_teach", []):
        try:
            reqteachlist.append(Subject.objects.get(id=ObjectId(i)))
        except Exception as e:
            return jsonify({"error": "Subject for reqteach with provided id not found", "details": str(e)}), 404
    org = None
    org_id_param = data.get("orgid")
    if org_id_param:
        try:
            org = Organization.objects.get(id=ObjectId(org_id_param))
        except Exception as e:
            return jsonify({"error": "Org with provided orgid not found", "details": str(e)}), 404
    else:
        org = user.orgid
    availabitylist = []
    for i in data.get("availability",[]):
        try:
            wts = WeekTime()
            wts.day = i["startday"]
            wts.time = i["starttime"]
            wte = WeekTime()
            wte.day = i["endday"]
            wte.time = i["endtime"]
            tb = TimeBlock()
            tb.start = wts
            tb.end = wte
            availabitylist.append(tb)

        except Exception as e:
            return jsonify({"error": "invalid format for availability list", "details": str(e)}), 400

    teacher = Teacher(
        name=name,
        orgid=org,
        created_at=created_at,
        tags=data.get("tags"),
        can_teach=canteachlist,
        required_teach=reqteachlist,
        availability=availabitylist,
    )
    teacher.save()
    return jsonify({"message": "Teacher created successfully", "teacher_id": str(teacher.id)}), 201

@teacherAPI.route("/<teacher_id>/delete", methods=["DELETE"])
def delete_teacher(teacher_id):
    user = get_logged_in_user()
    if not user:
        return jsonify({"error": "Unauthorized"}), 401

    try:
        teacher = Teacher.objects.get(id=ObjectId(teacher_id))
    except Exception:
        return jsonify({"error": "Teacher not found"}), 404

    if user.role not in ("admin"):
            return jsonify({"error": "Unauthorized"}), 401

    teacher.delete()
    return jsonify({"message": "Teacher deleted successfully"}), 200


@teacherAPI.route("/<teacher_id>/update", methods=["PUT"])
def update_teacher(teacher_id):
    user = get_logged_in_user()
    if not user:
        return jsonify({"error": "Unauthorized"}), 401
    try:
        teacher = Teacher.objects.get(id=ObjectId(teacher_id))
    except Exception:
        return jsonify({"error": "Teacher not found"}), 404

    data = request.json

    if "name" in data:
        teacher.name = data["name"]
    if "can_teach" in data:
        canteachlist = []
        for i in data.get("can_teach", []):
            try:
                canteachlist.append(Subject.objects.get(id=ObjectId(i)))
            except Exception as e:
                return jsonify({"error": "Subject for canteach with provided id not found", "details": str(e)}), 404
        teacher.can_teach = canteachlist
    if "required_teach" in data:
        reqteachlist = []
        for i in data.get("required_teach", []):
            try:
                reqteachlist.append(Subject.objects.get(id=ObjectId(i)))
            except Exception as e:
                return jsonify({"error": "Subject for reqteach with provided id not found", "details": str(e)}), 404
        teacher.required_teach = reqteachlist
    if "availability" in data:
        availabitylist = []
        for i in data.get("availability", []):
            try:
                # Support both nested and flat format
                if "start" in i and "end" in i:
                    startday = i["start"]["day"]
                    starttime = i["start"]["time"]
                    endday = i["end"]["day"]
                    endtime = i["end"]["time"]
                else:
                    startday = i["startday"]
                    starttime = i["starttime"]
                    endday = i["endday"]
                    endtime = i["endtime"]

                wts = WeekTime(day=startday, time=starttime)
                wte = WeekTime(day=endday, time=endtime)
                tb = TimeBlock(start=wts, end=wte)
                availabitylist.append(tb)

            except Exception as e:
                return jsonify({"error": "invalid format for availability list", "details": str(e)}), 400
        teacher.availability = availabitylist
    if "tags" in data:
        teacher.tags = data["tags"]

    teacher.save()
    return jsonify({"message": "Teacher updated successfully"}), 200


@teacherAPI.route("/<teacher_id>", methods=["GET"])
def get_teacher(teacher_id):

    user = get_logged_in_user()
    if not user:
        return jsonify({"error": "Unauthorized"}), 401

    try:
        teacher = Teacher.objects.get(id=ObjectId(teacher_id))
    except Exception:
        return jsonify({"error": "Teacher not found"}), 404

    # If the user is neither the owner nor teacher/admin => unauthorized

    return jsonify(json.loads(teacher.to_json())), 200

@teacherAPI.route("/all_org_teachers", methods=["GET"])
def get_teachers():
    user = get_logged_in_user()
    if not user:
        return jsonify({"error": "Unauthorized"}), 401

    result = []

    all_teachers = Teacher.objects()

    for teacher in all_teachers:
        if teacher.orgid == user.orgid:
            result.append(teacher)
    teachers_list = [json.loads(s.to_json()) for s in result]
    return jsonify(teachers_list), 200