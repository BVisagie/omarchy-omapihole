// Counts how often a text field fetches the clipboard text when it becomes
// writable and then sees two clipboard changes, without any paste.
// Before Qt 6.12.1 (qtdeclarative bcbfae67) a writable TextInput fetches it
// each time; TextEdit, which SetupField.qml is built on, only checks formats.
//
//   g++ -std=c++17 -fPIC tests/tools/clipboard_probe.cpp -o /tmp/clipboard_probe \
//       $(pkg-config --cflags --libs Qt6Quick Qt6Qml Qt6Gui) && /tmp/clipboard_probe
//
// Qt 6.12.0 prints 3 for TextInput and TextField, 0 for TextEdit and TextArea.
#include <QGuiApplication>
#include <QClipboard>
#include <QMimeData>
#include <QQmlEngine>
#include <QQmlComponent>
#include <QQuickItem>
#include <QPointer>
#include <cstdio>
class Counting : public QMimeData { public:
  explicit Counting(const QString &t){ setText(t); setData("text/plain;charset=utf-8", t.toUtf8()); }
  mutable int n = 0;
protected: QVariant retrieveData(const QString &m, QMetaType t) const override { ++n; return QMimeData::retrieveData(m,t); } };
static int probe(QQmlEngine &e, const char *qml) {
  QQmlComponent c(&e); c.setData(qml, QUrl()); QObject *o = c.create();
  if (!o) { fprintf(stderr, "%s\n", qPrintable(c.errorString())); return -1; }
  auto *cb = QGuiApplication::clipboard();
  QPointer<Counting> d = new Counting("hello"); cb->setMimeData(d); d->n = 0;
  o->setProperty("readOnly", false);           // as when the form opens
  QMetaObject::invokeMethod(cb, "dataChanged", Qt::DirectConnection); // offer changes
  QMetaObject::invokeMethod(cb, "dataChanged", Qt::DirectConnection);
  int r = d ? d->n : -2; delete o; return r; }
int main(int argc, char **argv) {
  qputenv("QT_QPA_PLATFORM", "offscreen"); QGuiApplication app(argc, argv); QQmlEngine e;
  printf("Qt %s\n", qVersion());
  printf("TextInput (writable): payload reads = %d\n", probe(e, "import QtQuick\nTextInput { readOnly: true }"));
  printf("QQC TextField:        payload reads = %d\n", probe(e, "import QtQuick.Controls\nTextField { readOnly: true }"));
  printf("TextEdit (writable):  payload reads = %d\n", probe(e, "import QtQuick\nTextEdit { readOnly: true }"));
  printf("QQC TextArea:         payload reads = %d\n", probe(e, "import QtQuick.Controls\nTextArea { readOnly: true }"));
}
