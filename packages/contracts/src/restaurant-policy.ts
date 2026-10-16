export const restaurantPolicy = {
  version: '2026-10-v3',
  updatedAt: '2026-10-08',
  title: 'Quy định sử dụng dịch vụ tại bàn',
  summary: [
    'Quét QR của đúng bàn, nhập tên và mã 4 số do nhân viên hoặc người cùng bàn cung cấp. Bạn chỉ sửa và gửi món mình đã thêm vào giỏ.',
    'Kiểm tra món, số lượng và giá trước khi gửi. Nhà hàng sẽ kiểm tra thêm những lượt gọi cần xác nhận.',
    'Bạn tự hủy món khi còn chờ bếp nhận. Sau đó, hãy nhờ nhân viên; đổi ý khi đã chế biến có thể vẫn tính tiền.',
    'Món hết trước chế biến không tính tiền. Nếu nhà hàng xác nhận món gặp lỗi, bạn không phải trả tiền món đó. Nếu đã thanh toán, nhân viên sẽ hỗ trợ hoàn khoản trả thừa.',
    'Thanh toán tiền mặt hoặc chuyển khoản do nhân viên xác nhận. Gửi yêu cầu chưa có nghĩa là đã trả tiền.',
    'Rời bàn chỉ xóa giỏ chưa gửi của bạn; món đã gọi và tiền của bàn vẫn được giữ. Cần hỗ trợ, hãy gọi nhân viên.',
  ],
  sections: [
    {
      title: 'Tham gia bàn và QR',
      text: 'Quét QR của đúng bàn, nhập tên và mã vào bàn gồm 4 số. Nhân viên cấp mã sau khi xác nhận khách tại bàn. Người đã tham gia có thể đọc mã trên thanh đầu trang cho người cùng bàn. Chỉ chia sẻ mã với người đang ngồi tại bàn; mã mới được cấp khi mở lượt khách mới. QR không phải mã thanh toán.',
    },
    {
      title: 'Tên và giỏ chung',
      text: 'Tên giúp mọi người nhận ra món bạn chọn. Người cùng bàn có thể xem tên và món bạn chọn. Bạn chỉ sửa và gửi món mình đã thêm; thêm vào giỏ chưa gửi món đến bếp.',
    },
    {
      title: 'Gọi món và duyệt',
      text: 'Kiểm tra món, số lượng, giá và ghi chú trước khi gửi. Một số lượt cần nhân viên duyệt; màn hình sẽ hiển thị trạng thái chờ. Nếu chưa có phản hồi hoặc cần thay đổi, hãy gọi hỗ trợ.',
    },
    {
      title: 'Hủy món trước chế biến',
      text: 'Bạn tự hủy món của mình khi còn chờ bếp nhận. Khi bếp đã nhận nhưng chưa bắt đầu chế biến, nhân viên có thể kiểm tra và hủy giúp. Món hủy đúng điều kiện không tính tiền; tiền đã trả thừa được xử lý hoàn riêng.',
    },
    {
      title: 'Đổi ý sau khi đã chế biến',
      text: 'Khi món bắt đầu chế biến, bạn không tự hủy được. Nhà hàng đã dùng nguyên liệu nên đổi ý ở giai đoạn này có thể vẫn tính tiền. Nhân viên sẽ trao đổi với bạn và báo người quản lý xem xét.',
    },
    {
      title: 'Món hết và lỗi nhà hàng',
      text: 'Món hết trước chế biến không tính tiền. Nếu có lỗi chế biến, chất lượng hoặc làm nhầm món sau khi đã bắt đầu, bếp dừng món và báo người quản lý. Khi nhà hàng xác nhận lỗi, món không tính tiền. Khiếu nại sau khi phục vụ được người quản lý xử lý riêng.',
    },
    {
      title: 'Giá và phiếu thanh toán',
      text: 'Hệ thống kiểm tra lại giá lúc gửi; nếu giá đã đổi, bạn cần xem và chọn theo giá mới. Hiện giá món chưa cộng thuế/phí riêng. Phiếu trên ứng dụng giúp bạn kiểm tra tiền món và các lần thanh toán; không phải hóa đơn thuế.',
    },
    {
      title: 'Thanh toán',
      text: 'Bạn có thể đề nghị trả toàn bộ hoặc một phần bằng tiền mặt/chuyển khoản. Nhân viên xác nhận sau khi nhận đủ tiền hoặc kiểm tra giao dịch ngân hàng. Chỉ khi nhân viên xác nhận đã nhận tiền, khoản thanh toán mới được ghi nhận trên bàn.',
    },
    {
      title: 'Hoàn tiền',
      text: 'Nếu bạn đã trả nhiều hơn số tiền cần thanh toán sau khi món được điều chỉnh, nhân viên sẽ hỗ trợ trả lại phần chênh lệch. Màn hình hiển thị khoản cần hoàn để bạn theo dõi; khoản hoàn chỉ được xác nhận sau khi tiền đã được trả lại.',
    },
    {
      title: 'Rời bàn và kết thúc phiên',
      text: 'Chọn Rời bàn sẽ xóa món chưa gửi của bạn và kết thúc lượt tham gia trên thiết bị này. Món đã gửi và tiền phát sinh vẫn thuộc bàn. Nhân viên chỉ kết thúc phiên khi đã hoàn tất các mục bắt buộc trong danh sách kiểm tra kết thúc bàn.',
    },
    {
      title: 'Hỗ trợ tại bàn',
      text: 'Bạn có thể gửi yêu cầu hỗ trợ trực tiếp từ màn hình tại bàn. Một yêu cầu cùng loại còn đang chờ hoặc được xử lý sẽ không tạo thêm yêu cầu trùng. Trạng thái được cập nhật khi nhân viên tiếp nhận và hoàn tất. Nút Gọi lại hiển thị thời gian còn chờ: 60 giây từ lúc gửi, hoặc 3 phút sau khi nhân viên tiếp nhận. Nếu vẫn chưa được hỗ trợ, bạn có thể gọi lại để đội phục vụ nhận yêu cầu mới. Không gọi lại khi nhân viên đang xử lý khoản thu; hãy trao đổi trực tiếp.',
    },
    {
      title: 'Hỗ trợ và yêu cầu đặc biệt',
      text: 'Dùng mục Hỗ trợ để gọi nhân viên, thêm nước/dụng cụ hoặc yêu cầu tính tiền. Với dị ứng, yêu cầu đặc biệt hoặc vấn đề chất lượng, hãy trao đổi trực tiếp với nhân viên; không mặc định ghi chú luôn được đáp ứng.',
    },
    {
      title: 'Thông tin phiên khách',
      text: 'Ứng dụng lưu tên bạn nhập, lượt tham gia trên thiết bị, món đã gọi, yêu cầu hỗ trợ và xác nhận quy định để phục vụ tại bàn, lưu lịch sử thanh toán. Người cùng bàn có thể thấy tên và món của bạn. Không nhập số thẻ, mật khẩu hoặc thông tin riêng tư vào tên và ghi chú.',
    },
  ],
  notices: {
    cart: 'Giỏ dùng chung cho bàn. Bạn chỉ sửa và gửi những món mình chọn; món trong giỏ chưa được gửi bếp.',
    submit:
      'Kiểm tra món và tổng tiền của lần gửi. Bạn tự hủy khi món còn chờ bếp nhận; khi bếp đã nhận, hãy nhờ nhân viên xử lý.',
    cancel:
      'Hủy món đang chờ bếp nhận? Món hủy thành công không tính tiền; nếu trạng thái đã đổi, hệ thống sẽ giữ món và báo lại.',
    leave:
      'Rời phiên bàn này? Giỏ chưa gửi của bạn sẽ bị xóa. Món đã gửi và số tiền đã phát sinh vẫn thuộc bàn, không bị xóa.',
    payment:
      'Chọn hình thức thanh toán và báo nhân viên đến bàn. Nhân viên sẽ trao đổi số tiền cần trả; thao tác gọi nhân viên chưa ghi nhận đã thanh toán.',
    bill: 'Yêu cầu tính tiền sẽ gọi nhân viên hỗ trợ; thao tác này chưa ghi nhận bạn đã trả tiền.',
    support:
      'Chọn việc bạn cần và gửi cho nhân viên. Nếu yêu cầu tính tiền, thao tác này chỉ gọi hỗ trợ, chưa ghi nhận đã thanh toán.',
    staffCancel:
      'Hủy những món chưa bắt đầu chế biến? Món hủy thành công không tính tiền. Nếu món đã chuyển trạng thái, nhân viên cần kiểm tra và xử lý riêng.',
    unavailable:
      'Dừng món chưa chế biến sẽ bỏ tính tiền và trả phần nguyên liệu đang giữ. Nhân viên được báo để trao đổi với khách; quản trị được báo để kiểm tra nguyên liệu hoặc thiết bị. Món tạm ngừng nhận thêm. Nếu khách đã trả thừa, cần hoàn tiền riêng.',
    prepare:
      'Bắt đầu chế biến sẽ ghi nhận nguyên liệu đã sử dụng. Từ bước này, hủy món không làm nguyên liệu quay lại kho.',
    issue:
      'Dừng món và báo quản trị? Nguyên liệu đã sử dụng được giữ trong lịch sử; quản trị quyết định món có tính tiền hay không.',
    fault:
      'Xác nhận lỗi nhà hàng: món không tính tiền, nguyên liệu đã dùng không nhập lại kho. Tiền đã trả thừa cần được hoàn riêng.',
    lateCancel:
      'Hủy theo yêu cầu sau chế biến vẫn tính tiền và giữ nguyên liệu đã sử dụng. Muốn miễn tiền phải có quyết định quản trị.',
    waive:
      'Miễn tiền món không xóa lịch sử phục vụ hoặc nguyên liệu đã sử dụng. Nếu khách đã trả thừa, nhân viên cần hoàn riêng.',
  },
} as const;

export const staffProcedure = {
  STAFF: [
    'Đến bàn kiểm tra khách trước khi cấp mã 4 số. Sau khi cấp mã, khách có thể gửi món thông thường đến bếp. Chỉ duyệt các lượt được hệ thống đánh dấu cần kiểm tra, từ chối cần lý do.',
    'Chỉ hủy trực tiếp trước chế biến. Món đã chế biến hoặc khiếu nại cần chuyển quản trị.',
    'Chỉ đánh dấu đã mang ra khi món thực sự đến bàn.',
    'Món bếp báo sự cố: đến bàn trao đổi trực tiếp với khách rồi xác nhận đã trao đổi. Bạn vẫn cần xác nhận đã trao đổi, kể cả khi quản trị đã quyết định tiền món.',
    'Chỉ xác nhận thu hoặc hoàn tiền sau khi đã nhận hoặc trả tiền thực tế. Kiểm tra số tiền và giao dịch chuyển khoản; trả tiền thừa và xác nhận đã trả. Giao phiếu cho khách hoặc ghi nhận khách không cần phiếu giấy.',
    'Nhận hỗ trợ để chịu trách nhiệm. Bàn giao chỉ đổi người phụ trách khi đồng nghiệp đồng ý; trong lúc chờ, bạn vẫn xử lý và có thể hoàn tất. Chỉ đóng bàn khi đã hoàn tất các mục bắt buộc trong danh sách kiểm tra kết thúc bàn.',
  ],
  KITCHEN: [
    'Nhận món → bắt đầu chế biến → báo món đã xong. Bắt đầu chế biến mới sử dụng nguyên liệu trong kho.',
    'Không thể phục vụ trước chế biến: chọn lý do để bỏ tính tiền món, báo phục vụ trao đổi với khách và báo quản trị kiểm tra nguyên liệu hoặc thiết bị. Món được tạm ngừng nhận thêm cho đến khi có thể phục vụ.',
    'Lỗi sau khi bắt đầu: chọn lý do có sẵn để dừng món và báo quản trị/phục vụ; ghi chú thêm nếu cần. Không tự miễn tiền.',
    'Món đã phục vụ: báo nhân viên/quản trị xử lý khiếu nại, không tự đổi trạng thái.',
  ],
  ADMIN: [
    'Nhấn thanh Việc cần xử lý ở mọi mục để mở các bàn bếp báo sự cố và tiền cần hoàn. Kiểm tra thông tin món và lý do bếp báo lỗi trước khi quyết định tiền món.',
    'Xác nhận lỗi sẽ bỏ tiền món trong cùng thao tác; không cần miễn lần nữa.',
    'Đổi ý sau chế biến có thể giữ tiền. Khiếu nại sau phục vụ dùng quyết định miễn riêng.',
    'Nếu khách đã thanh toán, hệ thống tính khoản cần hoàn. Quản trị hoặc phục vụ phải trả tiền thực tế cho khách và xác nhận giao dịch hoàn.',
    'Duyệt nhập/điều chỉnh tồn, đổi quyền và chốt lương sau khi kiểm tra; không sửa mất lịch sử.',
  ],
} as const;
