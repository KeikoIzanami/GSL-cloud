/****************************************************************************
** Meta object code from reading C++ file 'appmodel.h'
**
** Created by: The Qt Meta Object Compiler version 67 (Qt 5.15.18)
**
** WARNING! All changes made in this file will be lost!
*****************************************************************************/

#include <memory>
#include "../gui/appmodel.h"
#include <QtCore/qbytearray.h>
#include <QtCore/qmetatype.h>
#if !defined(Q_MOC_OUTPUT_REVISION)
#error "The header file 'appmodel.h' doesn't include <QObject>."
#elif Q_MOC_OUTPUT_REVISION != 67
#error "This file was generated using the moc from 5.15.18. It"
#error "cannot be used with the include files from this version of Qt."
#error "(The moc has changed too much.)"
#endif

QT_BEGIN_MOC_NAMESPACE
QT_WARNING_PUSH
QT_WARNING_DISABLE_DEPRECATED
struct qt_meta_stringdata_AppModel_t {
    QByteArrayData data[26];
    char stringdata0[343];
};
#define QT_MOC_LITERAL(idx, ofs, len) \
    Q_STATIC_BYTE_ARRAY_DATA_HEADER_INITIALIZER_WITH_OFFSET(len, \
    qptrdiff(offsetof(qt_meta_stringdata_AppModel_t, stringdata0) + ofs \
        - idx * sizeof(QByteArrayData)) \
    )
static const qt_meta_stringdata_AppModel_t qt_meta_stringdata_AppModel = {
    {
QT_MOC_LITERAL(0, 0, 8), // "AppModel"
QT_MOC_LITERAL(1, 9, 12), // "computerLost"
QT_MOC_LITERAL(2, 22, 0), // ""
QT_MOC_LITERAL(3, 23, 26), // "handleComputerStateChanged"
QT_MOC_LITERAL(4, 50, 11), // "NvComputer*"
QT_MOC_LITERAL(5, 62, 8), // "computer"
QT_MOC_LITERAL(6, 71, 18), // "handleBoxArtLoaded"
QT_MOC_LITERAL(7, 90, 5), // "NvApp"
QT_MOC_LITERAL(8, 96, 3), // "app"
QT_MOC_LITERAL(9, 100, 5), // "image"
QT_MOC_LITERAL(10, 106, 10), // "initialize"
QT_MOC_LITERAL(11, 117, 16), // "ComputerManager*"
QT_MOC_LITERAL(12, 134, 15), // "computerManager"
QT_MOC_LITERAL(13, 150, 13), // "computerIndex"
QT_MOC_LITERAL(14, 164, 15), // "showHiddenGames"
QT_MOC_LITERAL(15, 180, 19), // "createSessionForApp"
QT_MOC_LITERAL(16, 200, 8), // "Session*"
QT_MOC_LITERAL(17, 209, 8), // "appIndex"
QT_MOC_LITERAL(18, 218, 23), // "getDirectLaunchAppIndex"
QT_MOC_LITERAL(19, 242, 15), // "getRunningAppId"
QT_MOC_LITERAL(20, 258, 17), // "getRunningAppName"
QT_MOC_LITERAL(21, 276, 14), // "quitRunningApp"
QT_MOC_LITERAL(22, 291, 12), // "setAppHidden"
QT_MOC_LITERAL(23, 304, 6), // "hidden"
QT_MOC_LITERAL(24, 311, 18), // "setAppDirectLaunch"
QT_MOC_LITERAL(25, 330, 12) // "directLaunch"

    },
    "AppModel\0computerLost\0\0"
    "handleComputerStateChanged\0NvComputer*\0"
    "computer\0handleBoxArtLoaded\0NvApp\0app\0"
    "image\0initialize\0ComputerManager*\0"
    "computerManager\0computerIndex\0"
    "showHiddenGames\0createSessionForApp\0"
    "Session*\0appIndex\0getDirectLaunchAppIndex\0"
    "getRunningAppId\0getRunningAppName\0"
    "quitRunningApp\0setAppHidden\0hidden\0"
    "setAppDirectLaunch\0directLaunch"
};
#undef QT_MOC_LITERAL

static const uint qt_meta_data_AppModel[] = {

 // content:
       8,       // revision
       0,       // classname
       0,    0, // classinfo
      11,   14, // methods
       0,    0, // properties
       0,    0, // enums/sets
       0,    0, // constructors
       0,       // flags
       1,       // signalCount

 // signals: name, argc, parameters, tag, flags
       1,    0,   69,    2, 0x06 /* Public */,

 // slots: name, argc, parameters, tag, flags
       3,    1,   70,    2, 0x08 /* Private */,
       6,    3,   73,    2, 0x08 /* Private */,

 // methods: name, argc, parameters, tag, flags
      10,    3,   80,    2, 0x02 /* Public */,
      15,    1,   87,    2, 0x02 /* Public */,
      18,    0,   90,    2, 0x02 /* Public */,
      19,    0,   91,    2, 0x02 /* Public */,
      20,    0,   92,    2, 0x02 /* Public */,
      21,    0,   93,    2, 0x02 /* Public */,
      22,    2,   94,    2, 0x02 /* Public */,
      24,    2,   99,    2, 0x02 /* Public */,

 // signals: parameters
    QMetaType::Void,

 // slots: parameters
    QMetaType::Void, 0x80000000 | 4,    5,
    QMetaType::Void, 0x80000000 | 4, 0x80000000 | 7, QMetaType::QUrl,    5,    8,    9,

 // methods: parameters
    QMetaType::Void, 0x80000000 | 11, QMetaType::Int, QMetaType::Bool,   12,   13,   14,
    0x80000000 | 16, QMetaType::Int,   17,
    QMetaType::Int,
    QMetaType::Int,
    QMetaType::QString,
    QMetaType::Void,
    QMetaType::Void, QMetaType::Int, QMetaType::Bool,   17,   23,
    QMetaType::Void, QMetaType::Int, QMetaType::Bool,   17,   25,

       0        // eod
};

void AppModel::qt_static_metacall(QObject *_o, QMetaObject::Call _c, int _id, void **_a)
{
    if (_c == QMetaObject::InvokeMetaMethod) {
        auto *_t = static_cast<AppModel *>(_o);
        (void)_t;
        switch (_id) {
        case 0: _t->computerLost(); break;
        case 1: _t->handleComputerStateChanged((*reinterpret_cast< NvComputer*(*)>(_a[1]))); break;
        case 2: _t->handleBoxArtLoaded((*reinterpret_cast< NvComputer*(*)>(_a[1])),(*reinterpret_cast< NvApp(*)>(_a[2])),(*reinterpret_cast< QUrl(*)>(_a[3]))); break;
        case 3: _t->initialize((*reinterpret_cast< ComputerManager*(*)>(_a[1])),(*reinterpret_cast< int(*)>(_a[2])),(*reinterpret_cast< bool(*)>(_a[3]))); break;
        case 4: { Session* _r = _t->createSessionForApp((*reinterpret_cast< int(*)>(_a[1])));
            if (_a[0]) *reinterpret_cast< Session**>(_a[0]) = std::move(_r); }  break;
        case 5: { int _r = _t->getDirectLaunchAppIndex();
            if (_a[0]) *reinterpret_cast< int*>(_a[0]) = std::move(_r); }  break;
        case 6: { int _r = _t->getRunningAppId();
            if (_a[0]) *reinterpret_cast< int*>(_a[0]) = std::move(_r); }  break;
        case 7: { QString _r = _t->getRunningAppName();
            if (_a[0]) *reinterpret_cast< QString*>(_a[0]) = std::move(_r); }  break;
        case 8: _t->quitRunningApp(); break;
        case 9: _t->setAppHidden((*reinterpret_cast< int(*)>(_a[1])),(*reinterpret_cast< bool(*)>(_a[2]))); break;
        case 10: _t->setAppDirectLaunch((*reinterpret_cast< int(*)>(_a[1])),(*reinterpret_cast< bool(*)>(_a[2]))); break;
        default: ;
        }
    } else if (_c == QMetaObject::RegisterMethodArgumentMetaType) {
        switch (_id) {
        default: *reinterpret_cast<int*>(_a[0]) = -1; break;
        case 2:
            switch (*reinterpret_cast<int*>(_a[1])) {
            default: *reinterpret_cast<int*>(_a[0]) = -1; break;
            case 1:
                *reinterpret_cast<int*>(_a[0]) = qRegisterMetaType< NvApp >(); break;
            }
            break;
        case 3:
            switch (*reinterpret_cast<int*>(_a[1])) {
            default: *reinterpret_cast<int*>(_a[0]) = -1; break;
            case 0:
                *reinterpret_cast<int*>(_a[0]) = qRegisterMetaType< ComputerManager* >(); break;
            }
            break;
        }
    } else if (_c == QMetaObject::IndexOfMethod) {
        int *result = reinterpret_cast<int *>(_a[0]);
        {
            using _t = void (AppModel::*)();
            if (*reinterpret_cast<_t *>(_a[1]) == static_cast<_t>(&AppModel::computerLost)) {
                *result = 0;
                return;
            }
        }
    }
}

QT_INIT_METAOBJECT const QMetaObject AppModel::staticMetaObject = { {
    QMetaObject::SuperData::link<QAbstractListModel::staticMetaObject>(),
    qt_meta_stringdata_AppModel.data,
    qt_meta_data_AppModel,
    qt_static_metacall,
    nullptr,
    nullptr
} };


const QMetaObject *AppModel::metaObject() const
{
    return QObject::d_ptr->metaObject ? QObject::d_ptr->dynamicMetaObject() : &staticMetaObject;
}

void *AppModel::qt_metacast(const char *_clname)
{
    if (!_clname) return nullptr;
    if (!strcmp(_clname, qt_meta_stringdata_AppModel.stringdata0))
        return static_cast<void*>(this);
    return QAbstractListModel::qt_metacast(_clname);
}

int AppModel::qt_metacall(QMetaObject::Call _c, int _id, void **_a)
{
    _id = QAbstractListModel::qt_metacall(_c, _id, _a);
    if (_id < 0)
        return _id;
    if (_c == QMetaObject::InvokeMetaMethod) {
        if (_id < 11)
            qt_static_metacall(this, _c, _id, _a);
        _id -= 11;
    } else if (_c == QMetaObject::RegisterMethodArgumentMetaType) {
        if (_id < 11)
            qt_static_metacall(this, _c, _id, _a);
        _id -= 11;
    }
    return _id;
}

// SIGNAL 0
void AppModel::computerLost()
{
    QMetaObject::activate(this, &staticMetaObject, 0, nullptr);
}
QT_WARNING_POP
QT_END_MOC_NAMESPACE
