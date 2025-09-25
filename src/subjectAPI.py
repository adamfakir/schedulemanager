from flask import Blueprint, jsonify, request, session
from bson import ObjectId
from datetime import datetime, timezone
import json

from models.timemodels import TimeBlock, WeekTime
from models.subject import Subject
from models.organization import Organization
from routes.userAPI import get_logged_in_user

subjectAPI = Blueprint("subject", __name__)

def parse_datetime(dt_str):
    """Helper to parse ISO formatted datetime string if provided."""
    try:
        return datetime.fromisoformat(dt_str)
    except Exception:
        return None


@subjectAPI.route("/create", methods=["POST"])
def create_subject():
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
    displayname = data.get("displayname") or data.get("name")
    displayclass = data.get("displayclass") or None
    maxwd = data.get("maxwd")
    minwd = data.get("minwd")
    minld = data.get("minld")
    maxld = data.get("maxld")
    weight = data.get("weight")
    fixed = data.get("fixed")
    color = data.get("color")
    timeblockslist = []
    for i in data.get("timeblocks",[]):
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
            timeblockslist.append(tb)

        except Exception as e:
            return jsonify({"error": "invalid format for timeblocks list", "details": str(e)}), 400
    org = None
    org_id_param = data.get("orgid")
    if org_id_param:
        try:
            org = Organization.objects.get(id=ObjectId(org_id_param))
        except Exception as e:
            return jsonify({"error": "Org with provided orgid not found", "details": str(e)}), 404
    else:
        org = user.orgid
    subject = Subject(
        name=name,
        displayname=displayname,
        displayclass=displayclass,
        orgid=org,
        minwd=minwd,
        maxwd=maxwd,
        minld=minld,
        maxld=maxld,
        timeblocks=timeblockslist,
        weight=weight,
        fixed=fixed,
        color=color,
        created_at=created_at,
        tags=data.get("tags"),
    )
    subject.save()
    return jsonify({"message": "Subject created successfully", "sbujcet_id": str(subject.id)}), 201

@subjectAPI.route("/<subject_id>/delete", methods=["DELETE"])
def delete_subject(subject_id):
    user = get_logged_in_user()
    if not user:
        return jsonify({"error": "Unauthorized"}), 401
    try:
        subject = Subject.objects.get(id=ObjectId(subject_id))
    except Exception:
        return jsonify({"error": "Subject not found"}), 404

    if user.role not in ("admin"):
            return jsonify({"error": "Unauthorized"}), 401

    subject.delete()
    return jsonify({"message": "Subject deleted successfully"}), 200


@subjectAPI.route("/<subject_id>/update", methods=["PUT"])
def update_subject(subject_id):
    user = get_logged_in_user()
    if not user:
        return jsonify({"error": "Unauthorized"}), 401
    try:
        subject = Subject.objects.get(id=ObjectId(subject_id))
    except Exception:
        return jsonify({"error": "Subject not found"}), 404

    data = request.json

    if "name" in data:
        subject.name = data["name"]
    if "displayname" in data:
        subject.displayname = data["displayname"]
    if "displayclass" in data:
        subject.displayclass = data["displayclass"]
    if "timeblocks" in data:
        timeblockslist = []
        for i in data.get("timeblocks", []):
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
                timeblockslist.append(tb)
            except Exception as e:
                return jsonify({"error": "invalid format for timeblocks list", "details": str(e)}), 400
        subject.timeblocks = timeblockslist
    if "minwd" in data:
        subject.minwd = data["minwd"]
    if "maxwd" in data:
        subject.maxwd = data["maxwd"]
    if "minld" in data:
        subject.minld = data["minld"]
    if "maxld" in data:
        subject.maxld = data["maxld"]
    if "weight" in data:
        subject.weight = data["weight"]
    if "fixed" in data:
        subject.fixed = data["fixed"]
    if "color" in data:
        subject.color = data["color"]
    if "tags" in data:
        subject.tags = data["tags"]

    subject.save()
    return jsonify({"message": "Subject updated successfully"}), 200


@subjectAPI.route("/<subject_id>", methods=["GET"])
def get_subject(subject_id):

    user = get_logged_in_user()
    if not user:
        return jsonify({"error": "Unauthorized"}), 401

    try:
        subject = Subject.objects.get(id=ObjectId(subject_id))
    except Exception:
        return jsonify({"error": "Subject not found"}), 404

    # If the user is neither the owner nor teacher/admin => unauthorized

    return jsonify(json.loads(subject.to_json())), 200

@subjectAPI.route("/all_org_subjects", methods=["GET"])
def get_subjects():
    user = get_logged_in_user()
    if not user:
        return jsonify({"error": "Unauthorized"}), 401

    result = []

    all_subjects = Subject.objects()

    for subject in all_subjects:
        if subject.orgid == user.orgid:
            result.append(subject)
    subjects_list = [json.loads(s.to_json()) for s in result]
    return jsonify(subjects_list), 200